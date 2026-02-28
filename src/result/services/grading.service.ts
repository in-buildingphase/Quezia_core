import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * GRADING ENGINE (Deterministic & Reproducible)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ✅ Read ruleSnapshot only (never affected by blueprint changes)
 * ✅ Apply negative marking
 * ✅ Apply partial marking
 * ✅ Numeric tolerance validation
 * ✅ Floating-point safety (Prisma.Decimal)
 * ✅ Compute totalScore
 * ✅ Compute overall accuracy
 * ✅ Compute subject-wise accuracy
 * ✅ Compute topic-wise accuracy
 * ✅ Compute difficulty-wise accuracy
 * ✅ Compute risk ratio
 * ✅ Guarantee reproducibility
 * ✅ Guarantee independence from blueprint changes
 */

interface GradingResult {
  totalScore: Prisma.Decimal;
  accuracy: Prisma.Decimal;
  correctCount: number;
  attemptedCount: number;
  unattemptedCount: number;
  incorrectCount: number;

  // Subject-wise breakdown
  subjectBreakdown: Record<
    string,
    {
      correct: number;
      attempted: number;
      total: number;
      accuracy: number;
      score: Prisma.Decimal;
    }
  >;

  // Topic-wise breakdown
  topicBreakdown: Record<
    string,
    {
      subject: string;
      topic: string;
      correct: number;
      attempted: number;
      total: number;
      accuracy: number;
      score: Prisma.Decimal;
    }
  >;

  // Difficulty-wise breakdown
  difficultyBreakdown: Record<
    string,
    {
      correct: number;
      attempted: number;
      total: number;
      accuracy: number;
      score: Prisma.Decimal;
    }
  >;

  // Risk metrics
  riskRatio: Prisma.Decimal;
}

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Main grading engine entry point.
   * Deterministic, reproducible, and snapshot-based.
   */
  async calculateAttemptScore(
    attemptId: string,
  ): Promise<GradingResult | null> {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: true,
        questions: {
          include: {
            testQuestion: true,
          },
        },
      },
    });

    if (!attempt) return null;

    this.logger.log(
      `Grading attempt ${attemptId} with ${attempt.questions.length} questions`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 1. Extract ruleSnapshot (immutable, versioned rules)
    // ────────────────────────────────────────────────────────────────────
    const ruleSnapshot = attempt.test.ruleSnapshot as any;
    const negativeMarking = ruleSnapshot?.negativeMarking ?? false;
    const partialMarking = ruleSnapshot?.partialMarking ?? false;
    const defaultNegativeMarkValue = new Prisma.Decimal(
      ruleSnapshot?.negativeMarkValue || 0,
    );

    // ────────────────────────────────────────────────────────────────────
    // 2. Initialize tracking structures
    // ────────────────────────────────────────────────────────────────────
    let totalScore = new Prisma.Decimal(0);
    let correctCount = 0;
    let attemptedCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;

    const subjectBreakdown: Record<string, any> = {};
    const topicBreakdown: Record<string, any> = {};
    const difficultyBreakdown: Record<string, any> = {};

    // ────────────────────────────────────────────────────────────────────
    // 3. Grade each question
    // ────────────────────────────────────────────────────────────────────
    for (const aq of attempt.questions) {
      const tq = aq.testQuestion;
      const subject = tq.subject;
      const topic = tq.topic;
      const difficulty = tq.difficulty as string;
      const questionType = tq.questionType;

      // Initialize breakdown structures
      if (!subjectBreakdown[subject]) {
        subjectBreakdown[subject] = {
          correct: 0,
          attempted: 0,
          total: 0,
          accuracy: 0,
          score: new Prisma.Decimal(0),
        };
      }
      const topicKey = `${subject}:${topic}`;
      if (!topicBreakdown[topicKey]) {
        topicBreakdown[topicKey] = {
          subject,
          topic,
          correct: 0,
          attempted: 0,
          total: 0,
          accuracy: 0,
          score: new Prisma.Decimal(0),
        };
      }
      if (!difficultyBreakdown[difficulty]) {
        difficultyBreakdown[difficulty] = {
          correct: 0,
          attempted: 0,
          total: 0,
          accuracy: 0,
          score: new Prisma.Decimal(0),
        };
      }

      subjectBreakdown[subject].total++;
      topicBreakdown[topicKey].total++;
      difficultyBreakdown[difficulty].total++;

      // Check if question was attempted
      if (!aq.selectedAnswer || aq.selectedAnswer.trim() === '') {
        unattemptedCount++;
        continue;
      }

      attemptedCount++;
      subjectBreakdown[subject].attempted++;
      topicBreakdown[topicKey].attempted++;
      difficultyBreakdown[difficulty].attempted++;

      // ────────────────────────────────────────────────────────────────
      // 4. Evaluate correctness based on question type
      // ────────────────────────────────────────────────────────────────
      let isCorrect = false;
      let marksAwarded = new Prisma.Decimal(0);
      const fullMarks = new Prisma.Decimal(tq.marks);

      if (questionType === 'MCQ') {
        // MCQ: Exact match
        isCorrect = aq.selectedAnswer.trim() === tq.correctAnswer.trim();

        if (isCorrect) {
          marksAwarded = fullMarks;
        } else if (negativeMarking) {
          // Use per-question negative mark if available, else use default
          const negMarkValue = tq.negativeMarkValue
            ? new Prisma.Decimal(tq.negativeMarkValue)
            : defaultNegativeMarkValue;
          marksAwarded = negMarkValue.negated();
        }
      } else if (questionType === 'NUMERIC') {
        // NUMERIC: Tolerance-based validation
        const userAnswer = parseFloat(aq.selectedAnswer);
        const correctAnswer = parseFloat(tq.correctAnswer);
        const tolerance = tq.tolerance
          ? new Prisma.Decimal(tq.tolerance).toNumber()
          : 0;

        if (!isNaN(userAnswer) && !isNaN(correctAnswer)) {
          const diff = Math.abs(userAnswer - correctAnswer);
          isCorrect = diff <= tolerance;

          if (isCorrect) {
            marksAwarded = fullMarks;
          } else if (partialMarking && diff <= tolerance * 2) {
            // Partial marking: award 50% if within 2x tolerance
            marksAwarded = fullMarks.mul(0.5);
          } else if (negativeMarking) {
            const negMarkValue = tq.negativeMarkValue
              ? new Prisma.Decimal(tq.negativeMarkValue)
              : defaultNegativeMarkValue;
            marksAwarded = negMarkValue.negated();
          }
        } else if (negativeMarking) {
          // Invalid numeric input treated as incorrect
          const negMarkValue = tq.negativeMarkValue
            ? new Prisma.Decimal(tq.negativeMarkValue)
            : defaultNegativeMarkValue;
          marksAwarded = negMarkValue.negated();
        }
      }

      // ────────────────────────────────────────────────────────────────
      // 5. Update question-level results in DB
      // ────────────────────────────────────────────────────────────────
      await this.prisma.testAttemptQuestion.update({
        where: { id: aq.id },
        data: {
          isCorrect,
          marksAwarded,
        },
      });

      // ────────────────────────────────────────────────────────────────
      // 6. Update aggregate metrics
      // ────────────────────────────────────────────────────────────────
      totalScore = totalScore.plus(marksAwarded);

      if (isCorrect) {
        correctCount++;
        subjectBreakdown[subject].correct++;
        topicBreakdown[topicKey].correct++;
        difficultyBreakdown[difficulty].correct++;
      } else {
        incorrectCount++;
      }

      subjectBreakdown[subject].score =
        subjectBreakdown[subject].score.plus(marksAwarded);
      topicBreakdown[topicKey].score =
        topicBreakdown[topicKey].score.plus(marksAwarded);
      difficultyBreakdown[difficulty].score =
        difficultyBreakdown[difficulty].score.plus(marksAwarded);
    }

    // ────────────────────────────────────────────────────────────────────
    // 7. Calculate accuracy metrics
    // ────────────────────────────────────────────────────────────────────
    const overallAccuracy =
      attemptedCount > 0 ? (correctCount / attemptedCount) * 100 : 0;

    // Subject-wise accuracy
    for (const key in subjectBreakdown) {
      const sb = subjectBreakdown[key];
      sb.accuracy = sb.attempted > 0 ? (sb.correct / sb.attempted) * 100 : 0;
    }

    // Topic-wise accuracy
    for (const key in topicBreakdown) {
      const tb = topicBreakdown[key];
      tb.accuracy = tb.attempted > 0 ? (tb.correct / tb.attempted) * 100 : 0;
    }

    // Difficulty-wise accuracy
    for (const key in difficultyBreakdown) {
      const db = difficultyBreakdown[key];
      db.accuracy = db.attempted > 0 ? (db.correct / db.attempted) * 100 : 0;
    }

    // ────────────────────────────────────────────────────────────────────
    // 8. Calculate risk ratio
    // ────────────────────────────────────────────────────────────────────
    // Risk Ratio = (incorrect / total) / (unattempted / total)
    // Higher ratio = more aggressive (attempts questions even when uncertain)
    // Lower ratio = more cautious (skips uncertain questions)
    const totalQuestions = attempt.questions.length;
    const incorrectRate =
      totalQuestions > 0 ? incorrectCount / totalQuestions : 0;
    const unattemptedRate =
      totalQuestions > 0 ? unattemptedCount / totalQuestions : 0;

    let riskRatio = 0;
    if (unattemptedRate > 0) {
      riskRatio = incorrectRate / unattemptedRate;
    } else if (incorrectCount > 0) {
      // If no unattempted questions, risk ratio is high
      riskRatio = 2.0;
    } else {
      // Perfect score with all attempted = balanced risk
      riskRatio = 1.0;
    }

    this.logger.log(
      `Grading complete: Score=${totalScore}, Accuracy=${overallAccuracy.toFixed(2)}%, RiskRatio=${riskRatio.toFixed(2)}`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 9. Return comprehensive grading result
    // ────────────────────────────────────────────────────────────────────
    return {
      totalScore,
      accuracy: new Prisma.Decimal(overallAccuracy),
      correctCount,
      attemptedCount,
      unattemptedCount,
      incorrectCount,
      subjectBreakdown,
      topicBreakdown,
      difficultyBreakdown,
      riskRatio: new Prisma.Decimal(riskRatio),
    };
  }
}
