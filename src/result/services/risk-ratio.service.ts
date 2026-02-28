import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * RISK RATIO ENGINE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Computes:
 * ✅ Attempt aggressiveness
 * ✅ Incorrect vs unattempted ratio
 * ✅ Negative marking frequency
 * ✅ High-risk subject detection
 * ✅ Risk trend over time
 *
 * Stores result in:
 * - TestAttempt.riskRatio
 * - UserExamAnalytics.riskRatio (aggregated)
 */

interface RiskMetrics {
  // Overall risk ratio
  riskRatio: number; // Primary metric: incorrect / unattempted ratio
  riskClassification: string; // AGGRESSIVE, BALANCED, CAUTIOUS

  // Component metrics
  attemptRate: number; // % of questions attempted
  incorrectRate: number; // % of attempted questions that are incorrect
  skipRate: number; // % of questions skipped

  // Negative marking impact
  negativeMarkingImpact: number; // Total marks lost due to negative marking
  negativeMarkingFrequency: number; // % of questions with negative marks

  // Subject-wise risk
  subjectRisk: Record<
    string,
    {
      riskRatio: number;
      attemptRate: number;
      incorrectRate: number;
      classification: string;
    }
  >;

  // Difficulty-wise risk
  difficultyRisk: Record<
    string,
    {
      riskRatio: number;
      attemptRate: number;
      incorrectRate: number;
    }
  >;

  // Behavioral insights
  aggressivenessScore: number; // 0-100 (higher = more aggressive)
  cautionLevel: number; // 0-100 (higher = more cautious)
}

interface QuestionRiskData {
  questionId: string;
  subject: string;
  topic: string;
  difficulty: string;
  attempted: boolean;
  isCorrect: boolean | null;
  marksAwarded: number;
  marks: number;
  negativeMarking: boolean;
}

@Injectable()
export class RiskRatioService {
  private readonly logger = new Logger(RiskRatioService.name);

  /**
   * Main entry point for risk ratio computation
   */
  computeRiskMetrics(questions: QuestionRiskData[]): RiskMetrics {
    this.logger.log(`Computing risk metrics for ${questions.length} questions`);

    // ────────────────────────────────────────────────────────────────────
    // 1. Basic counts
    // ────────────────────────────────────────────────────────────────────
    const totalQuestions = questions.length;
    const attemptedQuestions = questions.filter((q) => q.attempted);
    const unattemptedQuestions = questions.filter((q) => !q.attempted);
    const incorrectQuestions = attemptedQuestions.filter(
      (q) => q.isCorrect === false,
    );
    const correctQuestions = attemptedQuestions.filter(
      (q) => q.isCorrect === true,
    );

    const attemptedCount = attemptedQuestions.length;
    const unattemptedCount = unattemptedQuestions.length;
    const incorrectCount = incorrectQuestions.length;
    const correctCount = correctQuestions.length;

    // ────────────────────────────────────────────────────────────────────
    // 2. Core rates
    // ────────────────────────────────────────────────────────────────────
    const attemptRate =
      totalQuestions > 0 ? (attemptedCount / totalQuestions) * 100 : 0;
    const skipRate =
      totalQuestions > 0 ? (unattemptedCount / totalQuestions) * 100 : 0;
    const incorrectRate =
      attemptedCount > 0 ? (incorrectCount / attemptedCount) * 100 : 0;

    // ────────────────────────────────────────────────────────────────────
    // 3. Risk Ratio Computation
    // ────────────────────────────────────────────────────────────────────
    // Risk Ratio = (incorrect / total) / (unattempted / total)
    // Simplified: incorrect / unattempted
    // Edge cases:
    //   - If unattempted = 0 and incorrect > 0: Very aggressive (high risk)
    //   - If unattempted = 0 and incorrect = 0: Perfect + aggressive = balanced/high
    //   - If incorrect = 0: Very cautious or very good

    let riskRatio = 0;

    if (unattemptedCount === 0) {
      // All questions attempted
      if (incorrectCount > 0) {
        // Aggressive risk-taker
        riskRatio = 2.0 + incorrectCount / totalQuestions;
      } else {
        // Perfect score with all attempts = confident & skilled
        riskRatio = 1.0;
      }
    } else if (incorrectCount === 0) {
      // No incorrect answers
      riskRatio = 0.1; // Very cautious or very accurate
    } else {
      // Normal case: ratio of incorrect to unattempted
      riskRatio = incorrectCount / unattemptedCount;
    }

    // ────────────────────────────────────────────────────────────────────
    // 4. Risk Classification
    // ────────────────────────────────────────────────────────────────────
    let riskClassification = 'BALANCED';
    let aggressivenessScore = 50;
    let cautionLevel = 50;

    if (riskRatio >= 2.0) {
      riskClassification = 'VERY_AGGRESSIVE';
      aggressivenessScore = 90;
      cautionLevel = 10;
    } else if (riskRatio >= 1.0) {
      riskClassification = 'AGGRESSIVE';
      aggressivenessScore = 70;
      cautionLevel = 30;
    } else if (riskRatio <= 0.3) {
      riskClassification = 'CAUTIOUS';
      aggressivenessScore = 30;
      cautionLevel = 70;
    } else if (riskRatio <= 0.5) {
      riskClassification = 'BALANCED';
      aggressivenessScore = 50;
      cautionLevel = 50;
    } else {
      riskClassification = 'SLIGHTLY_AGGRESSIVE';
      aggressivenessScore = 60;
      cautionLevel = 40;
    }

    // ────────────────────────────────────────────────────────────────────
    // 5. Negative Marking Impact
    // ────────────────────────────────────────────────────────────────────
    const negativelyMarkedQuestions = questions.filter(
      (q) => q.marksAwarded < 0,
    );
    const negativeMarkingFrequency =
      attemptedCount > 0
        ? (negativelyMarkedQuestions.length / attemptedCount) * 100
        : 0;

    const negativeMarkingImpact = negativelyMarkedQuestions.reduce(
      (sum, q) => sum + Math.abs(q.marksAwarded),
      0,
    );

    // ────────────────────────────────────────────────────────────────────
    // 6. Subject-wise risk
    // ────────────────────────────────────────────────────────────────────
    const subjectRisk = this.computeSubjectRisk(questions);

    // ────────────────────────────────────────────────────────────────────
    // 7. Difficulty-wise risk
    // ────────────────────────────────────────────────────────────────────
    const difficultyRisk = this.computeDifficultyRisk(questions);

    this.logger.log(
      `Risk analysis complete: Ratio=${riskRatio.toFixed(2)}, Classification=${riskClassification}, NegativeImpact=${negativeMarkingImpact.toFixed(2)}`,
    );

    return {
      riskRatio,
      riskClassification,
      attemptRate,
      incorrectRate,
      skipRate,
      negativeMarkingImpact,
      negativeMarkingFrequency,
      subjectRisk,
      difficultyRisk,
      aggressivenessScore,
      cautionLevel,
    };
  }

  /**
   * Compute subject-wise risk metrics
   */
  private computeSubjectRisk(
    questions: QuestionRiskData[],
  ): Record<string, any> {
    const subjectGroups: Record<string, QuestionRiskData[]> = {};

    for (const q of questions) {
      if (!subjectGroups[q.subject]) {
        subjectGroups[q.subject] = [];
      }
      subjectGroups[q.subject].push(q);
    }

    const result: Record<string, any> = {};

    for (const [subject, subjectQuestions] of Object.entries(subjectGroups)) {
      const total = subjectQuestions.length;
      const attempted = subjectQuestions.filter((q) => q.attempted).length;
      const unattempted = total - attempted;
      const incorrect = subjectQuestions.filter(
        (q) => q.attempted && q.isCorrect === false,
      ).length;

      const attemptRate = total > 0 ? (attempted / total) * 100 : 0;
      const incorrectRate = attempted > 0 ? (incorrect / attempted) * 100 : 0;

      let subjectRiskRatio = 0;
      if (unattempted === 0 && incorrect > 0) {
        subjectRiskRatio = 2.0;
      } else if (unattempted > 0) {
        subjectRiskRatio = incorrect / unattempted;
      }

      let classification = 'BALANCED';
      if (subjectRiskRatio >= 1.5) classification = 'HIGH_RISK';
      else if (subjectRiskRatio <= 0.4) classification = 'LOW_RISK';

      result[subject] = {
        riskRatio: Math.round(subjectRiskRatio * 100) / 100,
        attemptRate: Math.round(attemptRate),
        incorrectRate: Math.round(incorrectRate),
        classification,
      };
    }

    return result;
  }

  /**
   * Compute difficulty-wise risk metrics
   */
  private computeDifficultyRisk(
    questions: QuestionRiskData[],
  ): Record<string, any> {
    const difficultyGroups: Record<string, QuestionRiskData[]> = {};

    for (const q of questions) {
      if (!difficultyGroups[q.difficulty]) {
        difficultyGroups[q.difficulty] = [];
      }
      difficultyGroups[q.difficulty].push(q);
    }

    const result: Record<string, any> = {};

    for (const [difficulty, diffQuestions] of Object.entries(
      difficultyGroups,
    )) {
      const total = diffQuestions.length;
      const attempted = diffQuestions.filter((q) => q.attempted).length;
      const unattempted = total - attempted;
      const incorrect = diffQuestions.filter(
        (q) => q.attempted && q.isCorrect === false,
      ).length;

      const attemptRate = total > 0 ? (attempted / total) * 100 : 0;
      const incorrectRate = attempted > 0 ? (incorrect / attempted) * 100 : 0;

      let diffRiskRatio = 0;
      if (unattempted === 0 && incorrect > 0) {
        diffRiskRatio = 2.0;
      } else if (unattempted > 0) {
        diffRiskRatio = incorrect / unattempted;
      }

      result[difficulty] = {
        riskRatio: Math.round(diffRiskRatio * 100) / 100,
        attemptRate: Math.round(attemptRate),
        incorrectRate: Math.round(incorrectRate),
      };
    }

    return result;
  }

  /**
   * Compute aggregate risk ratio for user over time
   */
  computeAggregateRiskRatio(historicalAttempts: { riskRatio: number }[]): {
    averageRiskRatio: number;
    riskTrend: string; // INCREASING, DECREASING, STABLE
    volatility: number;
  } {
    if (historicalAttempts.length === 0) {
      return {
        averageRiskRatio: 0,
        riskTrend: 'STABLE',
        volatility: 0,
      };
    }

    const riskRatios = historicalAttempts.map((a) => a.riskRatio);
    const averageRiskRatio =
      riskRatios.reduce((a, b) => a + b, 0) / riskRatios.length;

    // Compute trend (compare recent half vs older half)
    let riskTrend = 'STABLE';
    if (riskRatios.length >= 4) {
      const mid = Math.floor(riskRatios.length / 2);
      const recentAvg =
        riskRatios.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const olderAvg =
        riskRatios.slice(mid).reduce((a, b) => a + b, 0) /
        (riskRatios.length - mid);

      const trendDelta = recentAvg - olderAvg;
      if (trendDelta > 0.2) riskTrend = 'INCREASING';
      else if (trendDelta < -0.2) riskTrend = 'DECREASING';
    }

    // Compute volatility (standard deviation)
    const variance =
      riskRatios.reduce((acc, val) => {
        return acc + Math.pow(val - averageRiskRatio, 2);
      }, 0) / riskRatios.length;
    const volatility = Math.sqrt(variance);

    return {
      averageRiskRatio: Math.round(averageRiskRatio * 100) / 100,
      riskTrend,
      volatility: Math.round(volatility * 100) / 100,
    };
  }
}
