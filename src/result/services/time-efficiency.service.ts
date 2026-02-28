import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * TIME EFFICIENCY ENGINE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Computes:
 * ✅ Average time per difficulty
 * ✅ Subject time distribution
 * ✅ Time vs accuracy correlation
 * ✅ Overthinking detection
 * ✅ Rushing detection
 * ✅ Time inefficiency flagging
 * ✅ Difficulty-time mismatch detection
 * ✅ Speed percentile (if needed)
 */

interface TimeEfficiencyMetrics {
  // Per-difficulty time metrics
  averageTimeByDifficulty: Record<
    string,
    {
      averageTime: number;
      expectedTime: number;
      variance: number;
      efficiency: number; // 0-100 scale
    }
  >;

  // Subject time distribution
  subjectTimeDistribution: Record<
    string,
    {
      totalTime: number;
      averageTime: number;
      percentage: number;
    }
  >;

  // Correlations
  timeAccuracyCorrelation: {
    correlation: number; // -1 to 1
    fastCorrect: number; // % correct when fast
    slowCorrect: number; // % correct when slow
  };

  // Behavioral flags
  overthinkingQuestions: string[]; // Question IDs with excessive time
  rushingQuestions: string[]; // Question IDs with insufficient time

  // Efficiency scores
  overallEfficiency: number; // 0-100
  inefficiencyIndex: number; // Higher = more inefficient

  // Mismatch detection
  difficultyTimeMismatches: {
    questionId: string;
    difficulty: string;
    actualTime: number;
    expectedTime: number;
    mismatchRatio: number;
  }[];
}

interface QuestionTimeData {
  questionId: string;
  testQuestionId: string;
  subject: string;
  topic: string;
  difficulty: string;
  timeSpent: number;
  isCorrect: boolean;
  marks: number;
}

@Injectable()
export class TimeEfficiencyService {
  private readonly logger = new Logger(TimeEfficiencyService.name);

  // Expected time benchmarks per difficulty (in seconds)
  private readonly EXPECTED_TIME: Record<string, number> = {
    EASY: 60, // 1 minute
    MEDIUM: 120, // 2 minutes
    HARD: 180, // 3 minutes
  };

  // Thresholds for behavioral detection
  private readonly OVERTHINKING_MULTIPLIER = 2.5; // 2.5x expected time
  private readonly RUSHING_MULTIPLIER = 0.3; // <30% of expected time

  /**
   * Analyzes time efficiency for a given attempt's questions
   */
  analyzeTimeEfficiency(
    questions: QuestionTimeData[],
    totalTime: number,
  ): TimeEfficiencyMetrics {
    this.logger.log(
      `Analyzing time efficiency for ${questions.length} questions`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 1. Average time by difficulty
    // ────────────────────────────────────────────────────────────────────
    const averageTimeByDifficulty =
      this.computeAverageTimeByDifficulty(questions);

    // ────────────────────────────────────────────────────────────────────
    // 2. Subject time distribution
    // ────────────────────────────────────────────────────────────────────
    const subjectTimeDistribution = this.computeSubjectTimeDistribution(
      questions,
      totalTime,
    );

    // ────────────────────────────────────────────────────────────────────
    // 3. Time vs accuracy correlation
    // ────────────────────────────────────────────────────────────────────
    const timeAccuracyCorrelation =
      this.computeTimeAccuracyCorrelation(questions);

    // ────────────────────────────────────────────────────────────────────
    // 4. Detect overthinking and rushing
    // ────────────────────────────────────────────────────────────────────
    const overthinkingQuestions: string[] = [];
    const rushingQuestions: string[] = [];
    const difficultyTimeMismatches: any[] = [];

    for (const q of questions) {
      const expectedTime = this.EXPECTED_TIME[q.difficulty] || 120;
      const overtimeThreshold = expectedTime * this.OVERTHINKING_MULTIPLIER;
      const rushThreshold = expectedTime * this.RUSHING_MULTIPLIER;

      if (q.timeSpent > overtimeThreshold) {
        overthinkingQuestions.push(q.questionId);
      }

      if (q.timeSpent < rushThreshold && q.timeSpent > 0) {
        rushingQuestions.push(q.questionId);
      }

      // Detect difficulty-time mismatch
      const mismatchRatio = q.timeSpent / expectedTime;
      if (mismatchRatio > 2.0 || mismatchRatio < 0.4) {
        difficultyTimeMismatches.push({
          questionId: q.questionId,
          difficulty: q.difficulty,
          actualTime: q.timeSpent,
          expectedTime,
          mismatchRatio,
        });
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 5. Compute overall efficiency
    // ────────────────────────────────────────────────────────────────────
    const overallEfficiency = this.computeOverallEfficiency(questions);
    const inefficiencyIndex = this.computeInefficiencyIndex(
      overthinkingQuestions.length,
      rushingQuestions.length,
      questions.length,
      timeAccuracyCorrelation.correlation,
    );

    this.logger.log(
      `Time efficiency analysis complete: Efficiency=${overallEfficiency.toFixed(1)}%, Inefficiency=${inefficiencyIndex.toFixed(2)}`,
    );

    return {
      averageTimeByDifficulty,
      subjectTimeDistribution,
      timeAccuracyCorrelation,
      overthinkingQuestions,
      rushingQuestions,
      overallEfficiency,
      inefficiencyIndex,
      difficultyTimeMismatches,
    };
  }

  /**
   * Computes average time spent per difficulty level
   */
  private computeAverageTimeByDifficulty(
    questions: QuestionTimeData[],
  ): Record<string, any> {
    const difficultyGroups: Record<string, number[]> = {
      EASY: [],
      MEDIUM: [],
      HARD: [],
    };

    for (const q of questions) {
      if (q.timeSpent && q.timeSpent > 0) {
        if (!difficultyGroups[q.difficulty]) {
          difficultyGroups[q.difficulty] = [];
        }
        difficultyGroups[q.difficulty].push(q.timeSpent);
      }
    }

    const result: Record<string, any> = {};

    for (const [difficulty, times] of Object.entries(difficultyGroups)) {
      if (times.length === 0) continue;

      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const expectedTime = this.EXPECTED_TIME[difficulty] || 120;

      // Calculate variance
      const variance =
        times.reduce((acc, time) => {
          return acc + Math.pow(time - averageTime, 2);
        }, 0) / times.length;

      // Efficiency: how close to expected time (100 = perfect, <100 = slower, >100 = faster)
      const efficiency = (expectedTime / averageTime) * 100;

      result[difficulty] = {
        averageTime: Math.round(averageTime),
        expectedTime,
        variance: Math.round(variance),
        efficiency: Math.round(efficiency),
      };
    }

    return result;
  }

  /**
   * Computes subject-wise time distribution
   */
  private computeSubjectTimeDistribution(
    questions: QuestionTimeData[],
    totalTime: number,
  ): Record<string, any> {
    const subjectTime: Record<string, number[]> = {};

    for (const q of questions) {
      if (!subjectTime[q.subject]) {
        subjectTime[q.subject] = [];
      }
      subjectTime[q.subject].push(q.timeSpent || 0);
    }

    const result: Record<string, any> = {};

    for (const [subject, times] of Object.entries(subjectTime)) {
      const totalSubjectTime = times.reduce((a, b) => a + b, 0);
      const averageTime = totalSubjectTime / times.length;
      const percentage =
        totalTime > 0 ? (totalSubjectTime / totalTime) * 100 : 0;

      result[subject] = {
        totalTime: Math.round(totalSubjectTime),
        averageTime: Math.round(averageTime),
        percentage: Math.round(percentage * 10) / 10,
      };
    }

    return result;
  }

  /**
   * Computes correlation between time spent and accuracy
   */
  private computeTimeAccuracyCorrelation(questions: QuestionTimeData[]): any {
    // Split questions into fast and slow based on median time
    const times = questions
      .map((q) => q.timeSpent || 0)
      .filter((t) => t > 0)
      .sort((a, b) => a - b);

    if (times.length === 0) {
      return {
        correlation: 0,
        fastCorrect: 0,
        slowCorrect: 0,
      };
    }

    const medianTime = times[Math.floor(times.length / 2)];

    const fastQuestions = questions.filter(
      (q) => q.timeSpent > 0 && q.timeSpent <= medianTime,
    );
    const slowQuestions = questions.filter((q) => q.timeSpent > medianTime);

    const fastCorrect =
      fastQuestions.length > 0
        ? (fastQuestions.filter((q) => q.isCorrect).length /
            fastQuestions.length) *
          100
        : 0;
    const slowCorrect =
      slowQuestions.length > 0
        ? (slowQuestions.filter((q) => q.isCorrect).length /
            slowQuestions.length) *
          100
        : 0;

    // Simple correlation: positive if slower = more correct, negative if faster = more correct
    const correlation = slowCorrect - fastCorrect; // Range: -100 to 100, normalize to -1 to 1
    const normalizedCorrelation = correlation / 100;

    return {
      correlation: Math.round(normalizedCorrelation * 100) / 100,
      fastCorrect: Math.round(fastCorrect),
      slowCorrect: Math.round(slowCorrect),
    };
  }

  /**
   * Computes overall time efficiency score (0-100)
   */
  private computeOverallEfficiency(questions: QuestionTimeData[]): number {
    let efficiencyScore = 100;

    for (const q of questions) {
      const expectedTime = this.EXPECTED_TIME[q.difficulty] || 120;
      const timeRatio = q.timeSpent / expectedTime;

      // Penalize deviation from expected time
      if (timeRatio > 1.5) {
        efficiencyScore -= 1; // Too slow
      } else if (timeRatio < 0.5 && !q.isCorrect) {
        efficiencyScore -= 2; // Too fast and wrong
      }
    }

    return Math.max(0, efficiencyScore);
  }

  /**
   * Computes inefficiency index (higher = worse)
   */
  private computeInefficiencyIndex(
    overthinkingCount: number,
    rushingCount: number,
    totalQuestions: number,
    correlation: number,
  ): number {
    if (totalQuestions === 0) return 0;

    const overthinkingRate = overthinkingCount / totalQuestions;
    const rushingRate = rushingCount / totalQuestions;

    // Inefficiency = weighted sum of behavioral issues
    // Overthinking is worse if correlation is negative (slow doesn't help)
    // Rushing is worse if correlation is positive (fast hurts accuracy)
    const overthinkingPenalty =
      correlation < 0 ? overthinkingRate * 0.6 : overthinkingRate * 0.3;
    const rushingPenalty =
      correlation > 0 ? rushingRate * 0.6 : rushingRate * 0.3;

    return (overthinkingPenalty + rushingPenalty) * 100;
  }
}
