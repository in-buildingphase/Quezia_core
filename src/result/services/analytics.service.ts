import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TimeEfficiencyService } from './time-efficiency.service';
import { RiskRatioService } from './risk-ratio.service';
import { TopicHealthService } from './topic-health.service';
import { PeerBenchmarkService } from './peer-benchmark.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeEfficiencyService: TimeEfficiencyService,
    private readonly riskRatioService: RiskRatioService,
    private readonly topicHealthService: TopicHealthService,
    private readonly peerBenchmarkService: PeerBenchmarkService,
  ) {}

  /**
   * Main entry point for transactional analytics updates.
   * Executed inside the same transaction as attempt completion.
   */
  async updateAll(
    tx: Prisma.TransactionClient,
    attemptId: string,
    gradingResults: any,
  ) {
    const attempt = await tx.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          include: {
            questions: true,
            thread: {
              select: {
                originType: true,
              },
            },
          },
        },
        questions: {
          include: {
            testQuestion: true,
          },
        },
      },
    });

    if (!attempt || !attempt.completedAt) {
      throw new Error('Attempt not found or not completed');
    }

    const { userId, testId, totalScore, accuracy, timeSpentSeconds } = attempt;
    const examId = attempt.test.examId;
    const isSystemTest = attempt.test.thread.originType === 'SYSTEM';

    this.logger.log(
      `Updating analytics for attempt ${attemptId}. Score: ${totalScore}, Accuracy: ${accuracy}, Origin: ${attempt.test.thread.originType}`,
    );

    // 1. Update Peer Benchmarking (ONLY for SYSTEM tests, not user-generated)
    let percentile = new Prisma.Decimal(0);
    let userRank: number | null = null;

    if (isSystemTest) {
      const benchmarkResult =
        await this.peerBenchmarkService.updatePeerBenchmark(
          tx,
          examId,
          attempt,
        );
      percentile = benchmarkResult.percentile;
      userRank = benchmarkResult.userRank;
      this.logger.log(
        `Peer benchmark updated: Percentile=${percentile}, Rank=${userRank}`,
      );
    } else {
      this.logger.log('Skipping peer benchmark for user-generated test');
    }

    // 2. Update Performance Trend (for all tests; percentile=0 for user-generated)
    await this.updatePerformanceTrend(tx, userId, examId, attempt, percentile);

    // 3. Update User Exam Analytics (with risk ratio from grading)
    await this.updateUserExamAnalytics(
      tx,
      userId,
      examId,
      attempt,
      gradingResults,
    );

    // 4. Update Subject and Topic Analytics (with enhanced data)
    await this.updateSubjectAndTopicAnalytics(
      tx,
      userId,
      examId,
      attempt,
      gradingResults,
    );

    // 5. Update attempt with computed metrics
    await tx.testAttempt.update({
      where: { id: attemptId },
      data: {
        percentile: isSystemTest ? percentile : null,
        userRank: isSystemTest ? userRank : null,
        riskRatio: gradingResults.riskRatio,
      },
    });
  }

  private async updateUserExamAnalytics(
    tx: Prisma.TransactionClient,
    userId: string,
    examId: string,
    currentAttempt: any,
    gradingResults: any,
  ) {
    const analytics = await tx.userExamAnalytics.findUnique({
      where: { userId_examId: { userId, examId } },
    });

    const newScore = new Prisma.Decimal(currentAttempt.totalScore || 0);
    const newAccuracy = new Prisma.Decimal(currentAttempt.accuracy || 0);
    const newTime = new Prisma.Decimal(currentAttempt.timeSpentSeconds || 0);
    const questionCount = currentAttempt.test.totalQuestions || 1;
    const avgTimePerQuestion = newTime.div(questionCount);

    // Extract risk ratio from grading results
    const riskRatio = gradingResults.riskRatio || new Prisma.Decimal(0);

    // Find weakest subject from grading breakdown
    let weakestSubject: string | null = null;
    if (gradingResults.subjectBreakdown) {
      const subjects = Object.entries(gradingResults.subjectBreakdown).sort(
        ([, a]: any, [, b]: any) => a.accuracy - b.accuracy,
      );
      if (subjects.length > 0) {
        weakestSubject = subjects[0][0];
      }
    }

    // Compute risk classification
    const riskRatioNum = riskRatio.toNumber();
    let riskClassification = 'Balanced';
    if (riskRatioNum >= 2.0) riskClassification = 'Very Aggressive';
    else if (riskRatioNum >= 1.0) riskClassification = 'Aggressive';
    else if (riskRatioNum <= 0.3) riskClassification = 'Cautious';

    // Compute time efficiency metrics
    const timeEfficiencyData = currentAttempt.questions.map((aq: any) => ({
      questionId: aq.testQuestion.questionId,
      testQuestionId: aq.testQuestion.id,
      subject: aq.testQuestion.subject,
      topic: aq.testQuestion.topic,
      difficulty: aq.testQuestion.difficulty,
      timeSpent: aq.timeSpentSeconds || 0,
      isCorrect: aq.isCorrect || false,
      marks: Number(aq.testQuestion.marks),
    }));

    const timeEfficiency = this.timeEfficiencyService.analyzeTimeEfficiency(
      timeEfficiencyData,
      newTime.toNumber(),
    );

    if (!analytics) {
      // First attempt
      await tx.userExamAnalytics.create({
        data: {
          userId,
          examId,
          overallAccuracy: newAccuracy,
          averageScore: newScore,
          currentStreak: 1,
          totalAttempts: 1,
          lastAttemptAt: currentAttempt.completedAt,
          averageTimePerQuestion: avgTimePerQuestion,
          weakestSubject,
          riskRatio,
          riskClassification,
          inefficiencyIndex: new Prisma.Decimal(
            timeEfficiency.inefficiencyIndex,
          ),
        },
      });
    } else {
      const oldAttempts = analytics.totalAttempts;
      const updatedTotalAttempts = oldAttempts + 1;

      // Incremental averages
      const updatedAvgScore = analytics.averageScore
        .mul(oldAttempts)
        .add(newScore)
        .div(updatedTotalAttempts);

      const updatedAvgAccuracy = analytics.overallAccuracy
        .mul(oldAttempts)
        .add(newAccuracy)
        .div(updatedTotalAttempts);

      const updatedAvgTimePerQ = analytics.averageTimePerQuestion
        .mul(oldAttempts)
        .add(avgTimePerQuestion)
        .div(updatedTotalAttempts);

      const updatedRiskRatio = analytics.riskRatio
        .mul(oldAttempts)
        .add(riskRatio)
        .div(updatedTotalAttempts);

      const updatedInefficiency = analytics.inefficiencyIndex
        .mul(oldAttempts)
        .add(timeEfficiency.inefficiencyIndex)
        .div(updatedTotalAttempts);

      // Streak logic
      const lastAttempt = await tx.testAttempt.findFirst({
        where: {
          userId,
          test: { examId },
          status: 'COMPLETED',
          id: { not: currentAttempt.id },
          completedAt: { lt: currentAttempt.completedAt },
        },
        orderBy: { completedAt: 'desc' },
      });

      let newStreak = 1;
      if (lastAttempt && newScore.gte(lastAttempt.totalScore || 0)) {
        newStreak = analytics.currentStreak + 1;
      }

      await tx.userExamAnalytics.update({
        where: { id: analytics.id },
        data: {
          overallAccuracy: updatedAvgAccuracy,
          averageScore: updatedAvgScore,
          currentStreak: newStreak,
          totalAttempts: updatedTotalAttempts,
          lastAttemptAt: currentAttempt.completedAt,
          averageTimePerQuestion: updatedAvgTimePerQ,
          weakestSubject,
          riskRatio: updatedRiskRatio,
          riskClassification,
          inefficiencyIndex: updatedInefficiency,
        },
      });
    }
  }

  private async updateSubjectAndTopicAnalytics(
    tx: Prisma.TransactionClient,
    userId: string,
    examId: string,
    attempt: any,
    gradingResults: any,
  ) {
    // Use grading breakdown if available, otherwise compute from questions
    if (gradingResults.subjectBreakdown) {
      // Update from grading breakdown
      for (const [subject, stats] of Object.entries(
        gradingResults.subjectBreakdown,
      )) {
        await this.updateUserSubjectAnalytics(
          tx,
          userId,
          examId,
          subject,
          stats as any,
          attempt.completedAt,
        );
      }
    }

    if (gradingResults.topicBreakdown) {
      // Update from topic breakdown
      for (const [topicKey, stats] of Object.entries(
        gradingResults.topicBreakdown,
      )) {
        await this.updateUserTopicAnalytics(
          tx,
          userId,
          examId,
          stats as any,
          attempt.completedAt,
        );
      }
    }
  }

  private async updateUserSubjectAnalytics(
    tx: Prisma.TransactionClient,
    userId: string,
    examId: string,
    subject: string,
    currentStats: any,
    timestamp: Date,
  ) {
    const analytics = await tx.userSubjectAnalytics.findUnique({
      where: { userId_examId_subject: { userId, examId, subject } },
    });

    const currentAccuracy =
      currentStats.attempted > 0
        ? (currentStats.correct / currentStats.attempted) * 100
        : 0;
    const currentAvgTime =
      currentStats.attempted > 0 && currentStats.time
        ? currentStats.time / currentStats.attempted
        : 0;

    if (!analytics) {
      await tx.userSubjectAnalytics.create({
        data: {
          userId,
          examId,
          subject,
          accuracy: new Prisma.Decimal(
            isNaN(currentAccuracy) ? 0 : currentAccuracy,
          ),
          attempts: 1,
          averageTime: new Prisma.Decimal(
            isNaN(currentAvgTime) ? 0 : currentAvgTime,
          ),
          trendDelta: new Prisma.Decimal(0),
          consistencyScore: new Prisma.Decimal(0),
          lastTestedAt: timestamp,
        },
      });
    } else {
      const updatedAttempts = analytics.attempts + 1;
      const updatedAccuracy = analytics.accuracy
        .mul(analytics.attempts)
        .add(currentAccuracy)
        .div(updatedAttempts);

      const updatedAvgTime = analytics.averageTime
        .mul(analytics.attempts)
        .add(currentAvgTime)
        .div(updatedAttempts);

      // Trend Delta
      const lastPerformances = await tx.$queryRaw<any[]>`
        SELECT 
          (SUM(CASE WHEN q."isCorrect" = true THEN 1 ELSE 0 END)::float / COUNT(*)) * 100 as accuracy
        FROM "TestAttemptQuestion" q
        JOIN "TestQuestion" tq ON q."testQuestionId" = tq.id
        JOIN "TestAttempt" ta ON q."attemptId" = ta.id
        WHERE ta."userId" = ${userId} 
          AND ta."status" = 'COMPLETED'
          AND tq."subject" = ${subject}
        GROUP BY ta.id
        ORDER BY ta."completedAt" DESC
        LIMIT 6
      `;

      let trendDelta = 0;
      if (lastPerformances.length >= 2) {
        const mid = Math.floor(lastPerformances.length / 2);
        const lastN = lastPerformances.slice(0, mid);
        const prevN = lastPerformances.slice(mid);

        const avgLast =
          lastN.reduce((acc, p) => acc + p.accuracy, 0) / lastN.length;
        const avgPrev =
          prevN.reduce((acc, p) => acc + p.accuracy, 0) / prevN.length;
        trendDelta = avgLast - avgPrev;
      }

      await tx.userSubjectAnalytics.update({
        where: { id: analytics.id },
        data: {
          accuracy: updatedAccuracy,
          attempts: updatedAttempts,
          averageTime: updatedAvgTime,
          trendDelta: new Prisma.Decimal(trendDelta),
          lastTestedAt: timestamp,
        },
      });
    }
  }
  private async updateUserTopicAnalytics(
    tx: Prisma.TransactionClient,
    userId: string,
    examId: string,
    stats: any,
    timestamp: Date,
  ) {
    const { subject, topic } = stats;
    const analytics = await tx.userTopicAnalytics.findUnique({
      where: {
        userId_examId_subject_topic: { userId, examId, subject, topic },
      },
    });

    // Compute current performance metrics
    const currentAccuracy =
      stats.attempted > 0 ? (stats.correct / stats.attempted) * 100 : 0;
    const incorrectCount = stats.attempted - stats.correct;
    const currentNegativeRate =
      stats.attempted > 0 ? (incorrectCount / stats.attempted) * 100 : 0;
    const currentAvgTime =
      stats.attempted > 0 && stats.time ? stats.time / stats.attempted : 0;

    // Prepare difficulty split data
    const easyTotal = stats.easyTotal || 0;
    const easyCorrect = stats.easyCorrect || 0;
    const mediumTotal = stats.mediumTotal || 0;
    const mediumCorrect = stats.mediumCorrect || 0;
    const hardTotal = stats.hardTotal || 0;
    const hardCorrect = stats.hardCorrect || 0;

    let updatedAttempts = 1;
    let updatedAccuracy = new Prisma.Decimal(
      isNaN(currentAccuracy) ? 0 : currentAccuracy,
    );
    let updatedAvgTime = new Prisma.Decimal(
      isNaN(currentAvgTime) ? 0 : currentAvgTime,
    );
    let updatedNegativeRate = new Prisma.Decimal(
      isNaN(currentNegativeRate) ? 0 : currentNegativeRate,
    );
    let updatedEasyAcc =
      easyTotal > 0
        ? new Prisma.Decimal((easyCorrect / easyTotal) * 100)
        : new Prisma.Decimal(0);
    let updatedMedAcc =
      mediumTotal > 0
        ? new Prisma.Decimal((mediumCorrect / mediumTotal) * 100)
        : new Prisma.Decimal(0);
    let updatedHardAcc =
      hardTotal > 0
        ? new Prisma.Decimal((hardCorrect / hardTotal) * 100)
        : new Prisma.Decimal(0);

    if (analytics) {
      updatedAttempts = analytics.attempts + 1;
      updatedAccuracy = analytics.accuracy
        .mul(analytics.attempts)
        .add(currentAccuracy)
        .div(updatedAttempts);
      updatedAvgTime = analytics.averageTime
        .mul(analytics.attempts)
        .add(currentAvgTime)
        .div(updatedAttempts);
      updatedNegativeRate = analytics.negativeRate
        .mul(analytics.attempts)
        .add(currentNegativeRate)
        .div(updatedAttempts);

      // Update difficulty accuracies
      if (easyTotal > 0) {
        updatedEasyAcc = analytics.easyAccuracy
          .mul(analytics.attempts)
          .add((easyCorrect / easyTotal) * 100)
          .div(updatedAttempts);
      } else {
        updatedEasyAcc = analytics.easyAccuracy;
      }

      if (mediumTotal > 0) {
        updatedMedAcc = analytics.mediumAccuracy
          .mul(analytics.attempts)
          .add((mediumCorrect / mediumTotal) * 100)
          .div(updatedAttempts);
      } else {
        updatedMedAcc = analytics.mediumAccuracy;
      }

      if (hardTotal > 0) {
        updatedHardAcc = analytics.hardAccuracy
          .mul(analytics.attempts)
          .add((hardCorrect / hardTotal) * 100)
          .div(updatedAttempts);
      } else {
        updatedHardAcc = analytics.hardAccuracy;
      }
    }

    // Fetch historical performance for topic health engine
    const historicalPerformances = await this.fetchTopicHistoricalPerformances(
      tx,
      userId,
      examId,
      subject,
      topic,
    );

    // Use Topic Health Engine to compute health status
    const currentHealthData = {
      accuracy: updatedAccuracy.toNumber(),
      attempts: updatedAttempts,
      timestamp,
      easyCorrect,
      easyTotal,
      mediumCorrect,
      mediumTotal,
      hardCorrect,
      hardTotal,
    };

    const topicHealth = this.topicHealthService.analyzeTopicHealth(
      currentHealthData,
      historicalPerformances,
    );

    const data = {
      userId,
      examId,
      subject,
      topic,
      accuracy: updatedAccuracy,
      attempts: updatedAttempts,
      averageTime: updatedAvgTime,
      negativeRate: updatedNegativeRate,
      easyAccuracy: updatedEasyAcc,
      mediumAccuracy: updatedMedAcc,
      hardAccuracy: updatedHardAcc,
      trendDelta: new Prisma.Decimal(topicHealth.trendScore),
      consistencyScore: new Prisma.Decimal(topicHealth.consistencyScore),
      lastTestedAt: timestamp,
      healthStatus: topicHealth.healthStatus,
    };

    if (!analytics) {
      await tx.userTopicAnalytics.create({ data });
    } else {
      await tx.userTopicAnalytics.update({
        where: { id: analytics.id },
        data,
      });
    }
  }

  /**
   * Fetch historical topic performances for health analysis
   */
  private async fetchTopicHistoricalPerformances(
    tx: Prisma.TransactionClient,
    userId: string,
    examId: string,
    subject: string,
    topic: string,
  ): Promise<any[]> {
    const history = await tx.$queryRaw<any[]>`
      SELECT 
        ta."completedAt" as timestamp,
        (SUM(CASE WHEN taq."isCorrect" = true THEN 1 ELSE 0 END)::float / COUNT(*)) * 100 as accuracy,
        COUNT(*) as attempts,
        SUM(CASE WHEN tq."difficulty" = 'EASY' AND taq."isCorrect" = true THEN 1 ELSE 0 END) as "easyCorrect",
        SUM(CASE WHEN tq."difficulty" = 'EASY' THEN 1 ELSE 0 END) as "easyTotal",
        SUM(CASE WHEN tq."difficulty" = 'MEDIUM' AND taq."isCorrect" = true THEN 1 ELSE 0 END) as "mediumCorrect",
        SUM(CASE WHEN tq."difficulty" = 'MEDIUM' THEN 1 ELSE 0 END) as "mediumTotal",
        SUM(CASE WHEN tq."difficulty" = 'HARD' AND taq."isCorrect" = true THEN 1 ELSE 0 END) as "hardCorrect",
        SUM(CASE WHEN tq."difficulty" = 'HARD' THEN 1 ELSE 0 END) as "hardTotal"
      FROM "TestAttempt" ta
      JOIN "TestAttemptQuestion" taq ON taq."attemptId" = ta."id"
      JOIN "TestQuestion" tq ON tq."id" = taq."testQuestionId"
      WHERE ta."userId" = ${userId}
        AND ta."status" = 'COMPLETED'
        AND tq."topic" = ${topic}
        AND tq."subject" = ${subject}
      GROUP BY ta."id", ta."completedAt"
      ORDER BY ta."completedAt" DESC
      LIMIT 5
    `;

    return history.map((h) => ({
      accuracy: Number(h.accuracy),
      attempts: Number(h.attempts),
      timestamp: new Date(h.timestamp),
      easyCorrect: Number(h.easyCorrect),
      easyTotal: Number(h.easyTotal),
      mediumCorrect: Number(h.mediumCorrect),
      mediumTotal: Number(h.mediumTotal),
      hardCorrect: Number(h.hardCorrect),
      hardTotal: Number(h.hardTotal),
    }));
  }

  private async updatePerformanceTrend(
    tx: Prisma.TransactionClient,
    userId: string,
    examId: string,
    attempt: any,
    percentile: Prisma.Decimal,
  ) {
    await tx.performanceTrend.create({
      data: {
        userId,
        examId,
        attemptId: attempt.id,
        testDate: attempt.completedAt,
        score: new Prisma.Decimal(attempt.totalScore || 0),
        accuracy: new Prisma.Decimal(attempt.accuracy || 0),
        percentile,
      },
    });
  }
}
