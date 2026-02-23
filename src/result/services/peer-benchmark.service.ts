import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PEER BENCHMARKING SERVICE
 * 
 * Responsibilities:
 * - Maintain exam-level score distribution
 * - Maintain subject-level averages
 * - Compute percentile bands
 * - Assign percentile on attempt completion
 * - Compute rank within cohort
 * - Separate cohorts by: exam, blueprint version, test format class
 * 
 * CRITICAL: 
 * - Percentiles are NOT computed dynamically per request
 * - Only applies to SYSTEM-originated tests (not user-generated custom tests)
 * - User-generated tests don't have meaningful peer comparisons
 */
@Injectable()
export class PeerBenchmarkService {
  private readonly logger = new Logger(PeerBenchmarkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update peer benchmark for a completed attempt.
   * Called within the transaction during attempt completion.
   * 
   * Returns: Computed percentile and rank
   */
  async updatePeerBenchmark(
    tx: Prisma.TransactionClient,
    examId: string,
    attempt: any,
  ): Promise<{ percentile: Prisma.Decimal; userRank: number }> {
    const score = Number(attempt.totalScore || 0);
    const blueprintVersion = attempt.test.blueprintReferenceId
      ? await this.getBlueprintVersion(tx, attempt.test.blueprintReferenceId)
      : null;

    // Define cohort key: examId + optional blueprint version
    const cohortKey = blueprintVersion
      ? `${examId}_v${blueprintVersion}`
      : examId;

    // Use row-level locking for concurrency safety
    // Split query to avoid Postgres type inference failure on null parameters
    const benchmarks = blueprintVersion !== null
      ? await tx.$queryRaw<any[]>`
          SELECT * FROM "PeerBenchmark"
          WHERE "examId" = ${examId}
          AND "blueprintVersion" = ${blueprintVersion}
          FOR UPDATE
        `
      : await tx.$queryRaw<any[]>`
          SELECT * FROM "PeerBenchmark"
          WHERE "examId" = ${examId}
          AND "blueprintVersion" IS NULL
          FOR UPDATE
        `;

    let benchmark: any;

    if (benchmarks.length === 0) {
      // Initialize new cohort benchmark
      benchmark = await this.initializeBenchmark(
        tx,
        examId,
        blueprintVersion,
        score,
        attempt,
      );
    } else {
      // Update existing cohort benchmark
      benchmark = await this.updateExistingBenchmark(
        tx,
        benchmarks[0],
        score,
        attempt,
      );
    }

    // Compute percentile and rank
    const percentile = this.computePercentile(benchmark, score);
    const rank = this.computeRank(benchmark, score);

    this.logger.log(
      `Attempt ${attempt.id}: Score=${score}, Percentile=${percentile}, Rank=${rank}, Cohort=${cohortKey}`,
    );

    return { percentile, userRank: rank };
  }

  /**
   * Initialize a new peer benchmark record for a cohort
   */
  private async initializeBenchmark(
    tx: Prisma.TransactionClient,
    examId: string,
    blueprintVersion: number | null,
    score: number,
    attempt: any,
  ) {
    // Initialize score distribution (buckets of 10)
    const distribution: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      distribution[`bucket_${i * 10}_${(i + 1) * 10}`] = 0;
    }

    const bucketKey = this.getScoreBucket(score);
    distribution[bucketKey] = 1;

    // Initialize subject averages
    const subjectAverages = await this.computeSubjectAverages(tx, attempt);

    // Initialize percentile bands (will be refined as more data comes in)
    const percentileBands = this.initializePercentileBands();

    return await tx.peerBenchmark.create({
      data: {
        examId,
        blueprintVersion,
        totalParticipants: 1,
        scoreDistribution: distribution as any,
        subjectAverages: subjectAverages as any,
        percentileBands: percentileBands as any,
        computedAt: new Date(),
        lastRecalculatedAt: new Date(),
      },
    });
  }

  /**
   * Update existing peer benchmark with new attempt data
   */
  private async updateExistingBenchmark(
    tx: Prisma.TransactionClient,
    benchmark: any,
    score: number,
    attempt: any,
  ) {
    // Update score distribution
    const distribution = benchmark.scoreDistribution as Record<string, number>;
    const bucketKey = this.getScoreBucket(score);
    distribution[bucketKey] = (distribution[bucketKey] || 0) + 1;

    // Update subject averages incrementally
    const subjectAverages = await this.updateSubjectAverages(
      tx,
      benchmark.subjectAverages as any,
      attempt,
      benchmark.totalParticipants,
    );

    // Update percentile bands
    const percentileBands = this.updatePercentileBands(
      distribution,
      benchmark.totalParticipants + 1,
    );

    return await tx.peerBenchmark.update({
      where: { id: benchmark.id },
      data: {
        totalParticipants: { increment: 1 },
        scoreDistribution: distribution as any,
        subjectAverages: subjectAverages as any,
        percentileBands: percentileBands as any,
        lastRecalculatedAt: new Date(),
      },
    });
  }

  /**
   * Compute percentile for a given score within the cohort
   * Formula: (number of scores below user score / total participants) * 100
   */
  private computePercentile(benchmark: any, score: number): Prisma.Decimal {
    const distribution = benchmark.scoreDistribution as Record<string, number>;
    const bucketIndex = Math.floor(Math.min(score, 99) / 10);

    let scoresBelow = 0;

    // Count all scores in buckets below current bucket
    for (let i = 0; i < bucketIndex; i++) {
      const key = `bucket_${i * 10}_${(i + 1) * 10}`;
      scoresBelow += distribution[key] || 0;
    }

    // Add half of the scores in the current bucket (approximation)
    const currentBucketKey = `bucket_${bucketIndex * 10}_${(bucketIndex + 1) * 10}`;
    const currentBucketCount = distribution[currentBucketKey] || 0;
    scoresBelow += Math.floor(currentBucketCount / 2);

    const percentile =
      benchmark.totalParticipants > 0
        ? (scoresBelow / benchmark.totalParticipants) * 100
        : 0;

    return new Prisma.Decimal(Math.max(0, Math.min(100, percentile)));
  }

  /**
   * Compute rank within cohort
   * Rank 1 = highest score
   */
  private computeRank(benchmark: any, score: number): number {
    const distribution = benchmark.scoreDistribution as Record<string, number>;
    const bucketIndex = Math.floor(Math.min(score, 99) / 10);

    let scoresAbove = 0;

    // Count all scores in buckets above current bucket
    for (let i = bucketIndex + 1; i < 10; i++) {
      const key = `bucket_${i * 10}_${(i + 1) * 10}`;
      scoresAbove += distribution[key] || 0;
    }

    // Add half of the scores in the current bucket (approximation)
    const currentBucketKey = `bucket_${bucketIndex * 10}_${(bucketIndex + 1) * 10}`;
    const currentBucketCount = distribution[currentBucketKey] || 0;
    scoresAbove += Math.floor(currentBucketCount / 2);

    return scoresAbove + 1; // Rank starts at 1
  }

  /**
   * Get score bucket key for a given score
   */
  private getScoreBucket(score: number): string {
    const bucketIndex = Math.floor(Math.min(score, 99) / 10);
    return `bucket_${bucketIndex * 10}_${(bucketIndex + 1) * 10}`;
  }

  /**
   * Compute subject-level averages from attempt questions
   */
  private async computeSubjectAverages(
    tx: Prisma.TransactionClient,
    attempt: any,
  ): Promise<Record<string, { avgScore: number; avgAccuracy: number }>> {
    const questions = await tx.testAttemptQuestion.findMany({
      where: { attemptId: attempt.id },
      include: { testQuestion: true },
    });

    const subjectStats: Record<
      string,
      { totalMarks: number; earnedMarks: number; total: number; correct: number }
    > = {};

    for (const q of questions) {
      const subject = q.testQuestion.subject;
      if (!subjectStats[subject]) {
        subjectStats[subject] = {
          totalMarks: 0,
          earnedMarks: 0,
          total: 0,
          correct: 0,
        };
      }

      subjectStats[subject].totalMarks += Number(q.testQuestion.marks);
      subjectStats[subject].earnedMarks += Number(q.marksAwarded || 0);
      subjectStats[subject].total += 1;
      if (q.isCorrect) {
        subjectStats[subject].correct += 1;
      }
    }

    const result: Record<
      string,
      { avgScore: number; avgAccuracy: number }
    > = {};

    for (const [subject, stats] of Object.entries(subjectStats)) {
      result[subject] = {
        avgScore:
          stats.totalMarks > 0
            ? (stats.earnedMarks / stats.totalMarks) * 100
            : 0,
        avgAccuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
      };
    }

    return result;
  }

  /**
   * Update subject averages incrementally using moving average
   */
  private async updateSubjectAverages(
    tx: Prisma.TransactionClient,
    currentAverages: Record<
      string,
      { avgScore: number; avgAccuracy: number }
    >,
    attempt: any,
    currentParticipants: number,
  ): Promise<Record<string, { avgScore: number; avgAccuracy: number }>> {
    const newSubjectData = await this.computeSubjectAverages(tx, attempt);

    const updated = { ...currentAverages };

    for (const [subject, newStats] of Object.entries(newSubjectData)) {
      if (updated[subject]) {
        // Incremental moving average
        const n = currentParticipants;
        updated[subject].avgScore =
          (updated[subject].avgScore * n + newStats.avgScore) / (n + 1);
        updated[subject].avgAccuracy =
          (updated[subject].avgAccuracy * n + newStats.avgAccuracy) / (n + 1);
      } else {
        // First entry for this subject
        updated[subject] = newStats;
      }
    }

    return updated;
  }

  /**
   * Initialize percentile bands structure
   */
  private initializePercentileBands(): Record<string, number> {
    return {
      p0_10: 0,
      p10_25: 0,
      p25_50: 0,
      p50_75: 0,
      p75_90: 0,
      p90_100: 0,
    };
  }

  /**
   * Update percentile bands based on score distribution
   */
  private updatePercentileBands(
    distribution: Record<string, number>,
    totalParticipants: number,
  ): Record<string, number> {
    if (totalParticipants === 0) return this.initializePercentileBands();

    // Sort buckets and compute cumulative percentiles
    const buckets = Object.entries(distribution).sort((a, b) => {
      const keyA = parseInt(a[0].split('_')[1]);
      const keyB = parseInt(b[0].split('_')[1]);
      return keyA - keyB;
    });

    let cumulative = 0;
    const bands = {
      p0_10: 0,
      p10_25: 0,
      p25_50: 0,
      p50_75: 0,
      p75_90: 0,
      p90_100: 0,
    };

    for (const [bucketKey, count] of buckets) {
      cumulative += count;
      const percentile = (cumulative / totalParticipants) * 100;
      const avgScore = parseInt(bucketKey.split('_')[1]) + 5; // Mid-point of bucket

      if (percentile <= 10) bands.p0_10 = avgScore;
      else if (percentile <= 25) bands.p10_25 = avgScore;
      else if (percentile <= 50) bands.p25_50 = avgScore;
      else if (percentile <= 75) bands.p50_75 = avgScore;
      else if (percentile <= 90) bands.p75_90 = avgScore;
      else bands.p90_100 = avgScore;
    }

    return bands;
  }

  /**
   * Get blueprint version from reference ID
   */
  private async getBlueprintVersion(
    tx: Prisma.TransactionClient,
    blueprintId: string,
  ): Promise<number | null> {
    const blueprint = await tx.examBlueprint.findUnique({
      where: { id: blueprintId },
      select: { version: true },
    });
    return blueprint?.version || null;
  }

  /**
   * Get peer benchmark statistics for an exam (admin view)
   */
  async getPeerBenchmarkStats(examId: string, blueprintVersion?: number) {
    const where: any = { examId };
    if (blueprintVersion !== undefined) {
      where.blueprintVersion = blueprintVersion;
    }

    return this.prisma.peerBenchmark.findMany({
      where,
      orderBy: { lastRecalculatedAt: 'desc' },
    });
  }

  /**
   * Get cohort statistics for a user's performance
   */
  async getUserCohortPerformance(
    userId: string,
    examId: string,
  ): Promise<{
    userPercentile: number;
    userRank: number;
    totalCohort: number;
    subjectComparison: any;
  }> {
    // Get user's latest completed attempt
    const latestAttempt = await this.prisma.testAttempt.findFirst({
      where: {
        userId,
        test: { examId },
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
      include: {
        test: true,
      },
    });

    if (!latestAttempt || !latestAttempt.percentile) {
      return {
        userPercentile: 0,
        userRank: 0,
        totalCohort: 0,
        subjectComparison: {},
      };
    }

    // Get benchmark for this cohort
    const blueprintVersion = latestAttempt.test.blueprintReferenceId
      ? await this.getBlueprintVersion(
          this.prisma,
          latestAttempt.test.blueprintReferenceId,
        )
      : null;

    const benchmark = await this.prisma.peerBenchmark.findFirst({
      where: {
        examId,
        blueprintVersion,
      },
    });

    if (!benchmark) {
      return {
        userPercentile: 0,
        userRank: 0,
        totalCohort: 0,
        subjectComparison: {},
      };
    }

    // Compute rank from percentile
    const rank = Math.ceil(
      (1 - Number(latestAttempt.percentile) / 100) *
        benchmark.totalParticipants,
    );

    return {
      userPercentile: Number(latestAttempt.percentile),
      userRank: rank,
      totalCohort: benchmark.totalParticipants,
      subjectComparison: benchmark.subjectAverages,
    };
  }
}
