import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * TOPIC HEALTH ENGINE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Classifies topic state using:
 * ✅ Accuracy
 * ✅ Attempt volume
 * ✅ Variance (consistency)
 * ✅ Trend direction
 * ✅ Recency
 * ✅ Difficulty split performance
 *
 * Output classification:
 * - STABLE: High accuracy, consistent, good volume
 * - IMPROVING: Positive trend, increasing accuracy
 * - VOLATILE: High variance, inconsistent performance
 * - WEAK: Low accuracy, needs attention
 *
 * Must be algorithmic and data-driven.
 */

interface TopicHealthMetrics {
  healthStatus: 'STABLE' | 'IMPROVING' | 'VOLATILE' | 'WEAK';
  healthScore: number; // 0-100

  // Component scores
  accuracyScore: number;
  volumeScore: number;
  trendScore: number;
  consistencyScore: number;
  recencyScore: number;
  difficultyBalanceScore: number;

  // Detailed metrics
  accuracy: number;
  attempts: number;
  variance: number;
  trendDirection: 'UP' | 'DOWN' | 'STABLE';
  daysSinceLastAttempt: number;

  // Difficulty breakdown
  easyAccuracy: number;
  mediumAccuracy: number;
  hardAccuracy: number;
  difficultyBalance: number; // How balanced across difficulties

  // Recommendations
  recommendations: string[];
}

interface TopicPerformanceData {
  accuracy: number;
  attempts: number;
  timestamp: Date;
  easyCorrect: number;
  easyTotal: number;
  mediumCorrect: number;
  mediumTotal: number;
  hardCorrect: number;
  hardTotal: number;
}

@Injectable()
export class TopicHealthService {
  private readonly logger = new Logger(TopicHealthService.name);

  // Thresholds for classification
  private readonly STABLE_THRESHOLD = 75;
  private readonly IMPROVING_THRESHOLD = 60;
  private readonly VOLATILE_THRESHOLD = 45;
  // Below VOLATILE_THRESHOLD = WEAK

  /**
   * Analyzes topic health and classifies it
   */
  analyzeTopicHealth(
    currentPerformance: TopicPerformanceData,
    historicalPerformances: TopicPerformanceData[],
  ): TopicHealthMetrics {
    this.logger.log(
      `Analyzing topic health: Accuracy=${currentPerformance.accuracy.toFixed(2)}%, Attempts=${currentPerformance.attempts}`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 1. Accuracy Score (0-35 points)
    // ────────────────────────────────────────────────────────────────────
    const accuracyScore = (currentPerformance.accuracy / 100) * 35;

    // ────────────────────────────────────────────────────────────────────
    // 2. Volume Score (0-15 points)
    // ────────────────────────────────────────────────────────────────────
    // More attempts = more reliable data
    const totalAttempts =
      historicalPerformances.reduce((sum, p) => sum + p.attempts, 0) +
      currentPerformance.attempts;
    const volumeScore = Math.min((totalAttempts / 20) * 15, 15); // Full score at 20+ attempts

    // ────────────────────────────────────────────────────────────────────
    // 3. Trend Score (0-15 points)
    // ────────────────────────────────────────────────────────────────────
    const { trendScore, trendDirection } = this.computeTrendScore(
      currentPerformance,
      historicalPerformances,
    );

    // ────────────────────────────────────────────────────────────────────
    // 4. Consistency Score (0-10 points)
    // ────────────────────────────────────────────────────────────────────
    const { consistencyScore, variance } = this.computeConsistencyScore(
      currentPerformance,
      historicalPerformances,
    );

    // ────────────────────────────────────────────────────────────────────
    // 5. Recency Score (0-10 points)
    // ────────────────────────────────────────────────────────────────────
    const daysSinceLastAttempt = this.getDaysSince(
      currentPerformance.timestamp,
    );
    const recencyScore = Math.max(10 - daysSinceLastAttempt, 0); // Lose 1 point per day

    // ────────────────────────────────────────────────────────────────────
    // 6. Difficulty Balance Score (0-15 points)
    // ────────────────────────────────────────────────────────────────────
    const {
      difficultyBalanceScore,
      easyAccuracy,
      mediumAccuracy,
      hardAccuracy,
      difficultyBalance,
    } = this.computeDifficultyBalance(currentPerformance);

    // ────────────────────────────────────────────────────────────────────
    // 7. Calculate Total Health Score
    // ────────────────────────────────────────────────────────────────────
    const healthScore =
      accuracyScore +
      volumeScore +
      trendScore +
      consistencyScore +
      recencyScore +
      difficultyBalanceScore;

    // ────────────────────────────────────────────────────────────────────
    // 8. Classify Health Status
    // ────────────────────────────────────────────────────────────────────
    let healthStatus: 'STABLE' | 'IMPROVING' | 'VOLATILE' | 'WEAK' = 'WEAK';

    if (healthScore >= this.STABLE_THRESHOLD) {
      healthStatus = 'STABLE';
    } else if (healthScore >= this.IMPROVING_THRESHOLD) {
      // Check if trend is positive to classify as IMPROVING
      if (trendDirection === 'UP') {
        healthStatus = 'IMPROVING';
      } else if (variance > 15) {
        // High variance even with decent score
        healthStatus = 'VOLATILE';
      } else {
        healthStatus = 'IMPROVING'; // Default for this range
      }
    } else if (healthScore >= this.VOLATILE_THRESHOLD) {
      // Check variance to determine VOLATILE vs WEAK
      if (variance > 20) {
        healthStatus = 'VOLATILE';
      } else {
        healthStatus = 'WEAK';
      }
    } else {
      healthStatus = 'WEAK';
    }

    // ────────────────────────────────────────────────────────────────────
    // 9. Generate Recommendations
    // ────────────────────────────────────────────────────────────────────
    const recommendations = this.generateRecommendations({
      healthStatus,
      healthScore,
      accuracy: currentPerformance.accuracy,
      trendDirection,
      variance,
      easyAccuracy,
      mediumAccuracy,
      hardAccuracy,
      totalAttempts,
      daysSinceLastAttempt,
    });

    this.logger.log(
      `Topic health analysis complete: Status=${healthStatus}, Score=${healthScore.toFixed(1)}/100`,
    );

    return {
      healthStatus,
      healthScore: Math.round(healthScore * 10) / 10,
      accuracyScore: Math.round(accuracyScore * 10) / 10,
      volumeScore: Math.round(volumeScore * 10) / 10,
      trendScore: Math.round(trendScore * 10) / 10,
      consistencyScore: Math.round(consistencyScore * 10) / 10,
      recencyScore: Math.round(recencyScore * 10) / 10,
      difficultyBalanceScore: Math.round(difficultyBalanceScore * 10) / 10,
      accuracy: Math.round(currentPerformance.accuracy * 10) / 10,
      attempts: totalAttempts,
      variance: Math.round(variance * 10) / 10,
      trendDirection,
      daysSinceLastAttempt,
      easyAccuracy,
      mediumAccuracy,
      hardAccuracy,
      difficultyBalance,
      recommendations,
    };
  }

  /**
   * Computes trend score based on historical performance
   */
  private computeTrendScore(
    current: TopicPerformanceData,
    historical: TopicPerformanceData[],
  ): { trendScore: number; trendDirection: 'UP' | 'DOWN' | 'STABLE' } {
    if (historical.length < 2) {
      return { trendScore: 7.5, trendDirection: 'STABLE' }; // Neutral score
    }

    // Sort by timestamp
    const sorted = [...historical, current].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    // Split into recent and older halves
    const mid = Math.floor(sorted.length / 2);
    const recentHalf = sorted.slice(mid);
    const olderHalf = sorted.slice(0, mid);

    const recentAvg =
      recentHalf.reduce((sum, p) => sum + p.accuracy, 0) / recentHalf.length;
    const olderAvg =
      olderHalf.reduce((sum, p) => sum + p.accuracy, 0) / olderHalf.length;

    const trendDelta = recentAvg - olderAvg;

    let trendDirection: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
    let trendScore = 7.5; // Neutral

    if (trendDelta > 5) {
      trendDirection = 'UP';
      trendScore = 7.5 + Math.min(trendDelta / 10, 7.5); // Max 15 points
    } else if (trendDelta < -5) {
      trendDirection = 'DOWN';
      trendScore = 7.5 - Math.min(Math.abs(trendDelta) / 10, 7.5); // Min 0 points
    } else {
      trendDirection = 'STABLE';
      trendScore = 7.5;
    }

    return { trendScore: Math.max(0, trendScore), trendDirection };
  }

  /**
   * Computes consistency score (lower variance = higher score)
   */
  private computeConsistencyScore(
    current: TopicPerformanceData,
    historical: TopicPerformanceData[],
  ): { consistencyScore: number; variance: number } {
    if (historical.length < 2) {
      return { consistencyScore: 5, variance: 0 }; // Neutral score
    }

    const allPerformances = [...historical, current];
    const accuracies = allPerformances.map((p) => p.accuracy);
    const mean = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;

    const variance =
      accuracies.reduce((sum, a) => {
        return sum + Math.pow(a - mean, 2);
      }, 0) / accuracies.length;

    // Lower variance = higher consistency
    // Variance of 0-10 = full score (10), variance of 30+ = zero score
    const consistencyScore = Math.max(0, 10 - variance / 3);

    return {
      consistencyScore,
      variance,
    };
  }

  /**
   * Computes difficulty balance score
   */
  private computeDifficultyBalance(performance: TopicPerformanceData): {
    difficultyBalanceScore: number;
    easyAccuracy: number;
    mediumAccuracy: number;
    hardAccuracy: number;
    difficultyBalance: number;
  } {
    const easyAccuracy =
      performance.easyTotal > 0
        ? (performance.easyCorrect / performance.easyTotal) * 100
        : 0;
    const mediumAccuracy =
      performance.mediumTotal > 0
        ? (performance.mediumCorrect / performance.mediumTotal) * 100
        : 0;
    const hardAccuracy =
      performance.hardTotal > 0
        ? (performance.hardCorrect / performance.hardTotal) * 100
        : 0;

    // Check coverage across difficulties
    const hasCoverage = [
      performance.easyTotal > 0,
      performance.mediumTotal > 0,
      performance.hardTotal > 0,
    ].filter(Boolean).length;

    const coverageScore = (hasCoverage / 3) * 5; // Max 5 points for full coverage

    // Check balance: ideal progression is easy > medium > hard accuracy
    let balanceScore = 0;
    if (easyAccuracy >= mediumAccuracy && mediumAccuracy >= hardAccuracy) {
      balanceScore = 10; // Perfect progression
    } else if (
      easyAccuracy >= mediumAccuracy ||
      mediumAccuracy >= hardAccuracy
    ) {
      balanceScore = 5; // Partial progression
    }

    const difficultyBalanceScore = coverageScore + balanceScore;

    // Overall balance metric (how well they handle all difficulties)
    const difficultyBalance =
      hasCoverage > 0
        ? ((easyAccuracy + mediumAccuracy + hardAccuracy) /
            (hasCoverage * 100)) *
          100
        : 0;

    return {
      difficultyBalanceScore,
      easyAccuracy: Math.round(easyAccuracy * 10) / 10,
      mediumAccuracy: Math.round(mediumAccuracy * 10) / 10,
      hardAccuracy: Math.round(hardAccuracy * 10) / 10,
      difficultyBalance: Math.round(difficultyBalance * 10) / 10,
    };
  }

  /**
   * Gets days since a given timestamp
   */
  private getDaysSince(timestamp: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Generates actionable recommendations based on health metrics
   */
  private generateRecommendations(metrics: any): string[] {
    const recommendations: string[] = [];

    if (metrics.healthStatus === 'WEAK') {
      recommendations.push('Priority: Focus on fundamentals in this topic');
      if (metrics.accuracy < 40) {
        recommendations.push('Review basic concepts and theory');
      }
      if (metrics.totalAttempts < 10) {
        recommendations.push('Practice more questions to build familiarity');
      }
    }

    if (metrics.healthStatus === 'VOLATILE') {
      recommendations.push('Performance is inconsistent - review approach');
      recommendations.push('Practice regularly to build stability');
    }

    if (metrics.trendDirection === 'DOWN') {
      recommendations.push('Recent performance declining - revisit concepts');
    }

    if (metrics.easyAccuracy < 70) {
      recommendations.push(
        'Strengthen basics before attempting harder questions',
      );
    }

    if (metrics.mediumAccuracy < 50 && metrics.easyAccuracy > 70) {
      recommendations.push('Bridge gap between easy and medium difficulty');
    }

    if (metrics.hardAccuracy < 30 && metrics.mediumAccuracy > 60) {
      recommendations.push('Ready to tackle more hard-level questions');
    }

    if (metrics.daysSinceLastAttempt > 7) {
      recommendations.push('Been a while - practice to maintain retention');
    }

    if (metrics.healthStatus === 'IMPROVING') {
      recommendations.push('Good progress - maintain consistency');
    }

    if (metrics.healthStatus === 'STABLE') {
      recommendations.push('Strong performance - consider harder variations');
    }

    return recommendations.slice(0, 3); // Limit to top 3 recommendations
  }
}
