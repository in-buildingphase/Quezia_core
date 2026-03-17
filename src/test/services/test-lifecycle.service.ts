import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus, Prisma, TestStatus, UserRole } from '@prisma/client';
import { GradingService } from '../../result/services/grading.service';
import { AnalyticsService } from '../../result/services/analytics.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import { SubmitAnswerDto } from '../dto/submit-answer.dto';
import { QuestionFetcherService } from './question-fetcher.service';

@Injectable()
export class TestLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly analyticsService: AnalyticsService,
    private readonly subscriptionService: SubscriptionService,
    private readonly questionFetcher: QuestionFetcherService,
  ) { }

  private toAttemptSummary(attempt: {
    id: string;
    testId: string;
    userId: string;
    status: AttemptStatus;
    startedAt: Date;
    completedAt: Date | null;
    totalScore: Prisma.Decimal | number | null;
    accuracy: Prisma.Decimal | number | null;
    timeSpentSeconds: number | null;
    percentile: Prisma.Decimal | number | null;
    userRank: number | null;
    riskRatio: Prisma.Decimal | number | null;
    endedAt: Date | null;
    test: {
      threadId: string | null;
      durationSeconds: number;
    };
    _count?: {
      questions: number;
    };
  }) {
    if (!attempt.test.threadId) {
      throw new InternalServerErrorException(
        'Attempt is missing threadId and cannot be grouped correctly',
      );
    }

    if (
      attempt.status === AttemptStatus.COMPLETED &&
      (attempt.totalScore === null || attempt.accuracy === null)
    ) {
      throw new InternalServerErrorException(
        'Completed attempt is missing grading data',
      );
    }

    const now = new Date();
    const questionsAnswered = attempt._count?.questions ?? 0;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000),
    );
    const timeRemainingSeconds = Math.max(
      0,
      attempt.test.durationSeconds - elapsedSeconds,
    );

    return {
      id: attempt.id,
      testId: attempt.testId,
      threadId: attempt.test.threadId,
      userId: attempt.userId,
      status: attempt.status,
      questionsAnswered,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      endedAt:
        attempt.status !== AttemptStatus.ACTIVE
          ? attempt.endedAt || attempt.completedAt || now
          : null,
      totalScore: attempt.totalScore,
      accuracy: attempt.accuracy,
      timeSpentSeconds: attempt.timeSpentSeconds,
      percentile: attempt.percentile,
      userRank: attempt.userRank,
      riskRatio: attempt.riskRatio,
      serverTime: now,
      timeRemainingSeconds,
      elapsedSeconds,
      testDurationSeconds: attempt.test.durationSeconds,
    };
  }

  async getAttempts(userId: string, threadId?: string) {
    const where: any = { userId };
    if (threadId) {
      where.test = { threadId };
    }

    const attempts = await this.prisma.testAttempt.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        testId: true,
        userId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        endedAt: true,
        totalScore: true,
        accuracy: true,
        timeSpentSeconds: true,
        percentile: true,
        userRank: true,
        riskRatio: true,
        test: {
          select: {
            threadId: true,
            durationSeconds: true,
          },
        },
        _count: {
          select: {
            questions: {
              where: {
                selectedAnswer: { not: null },
              },
            },
          },
        },
      },
    });

    return attempts.map((attempt) => this.toAttemptSummary(attempt));
  }

  async getAttemptById(attemptId: string, userId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        testId: true,
        userId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        endedAt: true,
        totalScore: true,
        accuracy: true,
        percentile: true,
        userRank: true,
        timeSpentSeconds: true,
        riskRatio: true,
        test: {
          select: {
            durationSeconds: true,
          },
        },
        _count: {
          select: {
            questions: {
              where: {
                selectedAnswer: { not: null },
              },
            },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');

    const now = new Date();
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000),
    );

    // Auto-submit if time has expired
    if (
      attempt.status === AttemptStatus.ACTIVE &&
      elapsedSeconds >= attempt.test.durationSeconds
    ) {
      await this.completeAttempt(attemptId, userId, true);
      return this.getAttemptById(attemptId, userId);
    }

    const questionsAnswered = attempt._count?.questions ?? 0;
    const timeRemainingSeconds = Math.max(
      0,
      attempt.test.durationSeconds - elapsedSeconds,
    );

    return {
      ...attempt,
      questionsAnswered,
      serverTime: now,
      timeRemainingSeconds,
      elapsedSeconds,
      testDurationSeconds: attempt.test.durationSeconds,
    };
  }

  async getAttemptQuestions(attemptId: string, userId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, testId: true, userId: true },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');

    // 1. Fetch static questions
    const questions = await this.prisma.testQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        questionId: true,
        sectionId: true,
        subject: true,
        topic: true,
        difficulty: true,
        questionType: true,
        contentSnapshot: true,
        marks: true,
        sequence: true,
      },
    });

    // 2. Fetch user progress for this attempt
    const attemptQuestions = await this.prisma.testAttemptQuestion.findMany({
      where: { attemptId },
      select: {
        testQuestionId: true,
        selectedAnswer: true,
        markedForReview: true,
      },
    });

    // 3. Create a lookup map
    const progressMap = new Map<
      string,
      { selectedAnswer: string | null; isMarked: boolean }
    >();
    for (const aq of attemptQuestions) {
      progressMap.set(aq.testQuestionId, {
        selectedAnswer: aq.selectedAnswer,
        isMarked: aq.markedForReview,
      });
    }

    // 4. Merge
    // Expose the stored snapshot as `contentPayload` so the API contract
    // matches the Question registry field name.
    return questions.map(({ contentSnapshot, ...rest }) => {
      const progress = progressMap.get(rest.id);
      return {
        ...rest,
        contentPayload: contentSnapshot,
        selectedAnswer: progress?.selectedAnswer ?? null,
        isMarked: progress?.isMarked ?? false,
      };
    });
  }

  async startAttempt(testId: string, userId: string) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: {
        questions: true,
        thread: { select: { originType: true } },
      },
    });

    if (!test) throw new NotFoundException('Test not found');
    if (test.status !== TestStatus.PUBLISHED) {
      throw new BadRequestException(
        'Cannot start attempt on a non-published test',
      );
    }

    // --- Subscription gating ---
    // Only SYSTEM tests require an active subscription.
    // GENERATED and INJECTED tests are accessible to any authenticated user.
    // Admins are always exempt.
    const isSystemTest = test.thread?.originType === 'SYSTEM';
    if (isSystemTest) {
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (actor?.role !== UserRole.ADMIN) {
        const hasAccess = await this.subscriptionService.hasActiveAccess(
          userId,
          test.examId,
        );
        if (!hasAccess) {
          throw new ForbiddenException(
            `No active subscription found for exam ${test.examId}`,
          );
        }
      }
    }

    const ATTEMPT_SELECT = {
      id: true,
      testId: true,
      userId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      totalScore: true,
      accuracy: true,
      percentile: true,
      userRank: true,
      timeSpentSeconds: true,
      riskRatio: true,
      test: {
        select: {
          durationSeconds: true,
        },
      },
      _count: {
        select: {
          questions: {
            where: {
              selectedAnswer: { not: null },
            },
          },
        },
      },
    } as const;

    // Use a Serializable transaction so concurrent requests cannot both pass the
    // "no active attempt" check and each create their own — PostgreSQL will abort
    // all but one with a serialization failure (P2034), which we then retry by
    // returning the already-created attempt.
    const tryCreate = () =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.testAttempt.findFirst({
            where: { testId, userId, status: AttemptStatus.ACTIVE },
            select: ATTEMPT_SELECT,
          });
          if (existing) return existing;

          return tx.testAttempt.create({
            data: {
              testId,
              userId,
              status: AttemptStatus.ACTIVE,
              startedAt: new Date(),
            },
            select: ATTEMPT_SELECT,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    try {
      const attemptResponse = await tryCreate();
      const now = new Date();
      const elapsedSeconds = Math.max(
        0,
        Math.floor((now.getTime() - attemptResponse.startedAt.getTime()) / 1000)
      );

      // Auto-submit if time has expired (for resumed attempts)
      if (
        attemptResponse.status === AttemptStatus.ACTIVE &&
        elapsedSeconds >= attemptResponse.test.durationSeconds
      ) {
        await this.completeAttempt(attemptResponse.id, userId, true);
        return this.getAttemptById(attemptResponse.id, userId);
      }

      const questionsAnswered = attemptResponse._count?.questions ?? 0;
      const timeRemainingSeconds = Math.max(
        0,
        attemptResponse.test.durationSeconds - elapsedSeconds
      );
      return {
        ...attemptResponse,
        questionsAnswered,
        serverTime: now,
        timeRemainingSeconds,
        elapsedSeconds,
        testDurationSeconds: attemptResponse.test.durationSeconds,
      };
    } catch (e: any) {
      // P2034: serialization failure — a concurrent tx won the race; return
      // whichever active attempt it created.
      if (e?.code === 'P2034') {
        const existing = await this.prisma.testAttempt.findFirst({
          where: { testId, userId, status: AttemptStatus.ACTIVE },
          select: ATTEMPT_SELECT,
        });
        if (existing) {
          const now = new Date();
          const elapsedSeconds = Math.max(
            0,
            Math.floor((now.getTime() - existing.startedAt.getTime()) / 1000)
          );

          // Auto-submit if time has expired
          if (elapsedSeconds >= existing.test.durationSeconds) {
            await this.completeAttempt(existing.id, userId, true);
            return this.getAttemptById(existing.id, userId);
          }

          const questionsAnswered = existing._count?.questions ?? 0;
          const timeRemainingSeconds = Math.max(
            0,
            existing.test.durationSeconds - elapsedSeconds
          );
          return {
            ...existing,
            questionsAnswered,
            serverTime: now,
            timeRemainingSeconds,
            elapsedSeconds,
            testDurationSeconds: existing.test.durationSeconds,
          };
        }
      }
      throw e;
    }
  }

  async submitAnswer(
    attemptId: string,
    dto: SubmitAnswerDto,
    userId: string,
  ) {
    const { questionId, answer } = dto;

    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        testId: true,
        userId: true,
        status: true,
        startedAt: true,
        test: {
          select: {
            durationSeconds: true,
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');
    if (attempt.status !== AttemptStatus.ACTIVE) {
      throw new BadRequestException('Attempt is no longer active');
    }

    const elapsedSeconds = (Date.now() - attempt.startedAt.getTime()) / 1000;

    // Strict cutoff
    if (elapsedSeconds >= attempt.test.durationSeconds) {
      await this.completeAttempt(attempt.id, userId, true);
      throw new BadRequestException('Test auto-submitted due to timeout');
    }

    const testQuestion = await this.prisma.testQuestion.findFirst({
      where: { testId: attempt.testId, questionId },
    });

    if (!testQuestion) {
      console.warn(
        `[TestLifecycleService] Question NOT found: ${questionId} for test ${attempt.testId}`,
      );
      throw new NotFoundException('Question not found in this test');
    }

    console.log(
      `[TestLifecycleService] Submitting answer for question ${questionId} (ID: ${testQuestion.id})`,
    );

    return this.prisma.testAttemptQuestion.upsert({
      where: {
        attemptId_testQuestionId: {
          attemptId,
          testQuestionId: testQuestion.id,
        },
      },
      update: {
        selectedAnswer: answer,
      },
      create: {
        attemptId,
        testQuestionId: testQuestion.id,
        selectedAnswer: answer,
      },
    });
  }

  async completeAttempt(
    attemptId: string,
    userId: string,
    isAutoSubmit = false,
  ) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        testId: true,
        userId: true,
        status: true,
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');
    if (attempt.status !== AttemptStatus.ACTIVE) {
      // Idempotent return handles double-submit (e.g. user hits submit right at zero + auto-submit triggered)
      if (attempt.status === AttemptStatus.COMPLETED || attempt.status === AttemptStatus.EXPIRED) {
        return this.getAttemptById(attemptId, userId);
      }
      throw new BadRequestException('Attempt already completed');
    }

    // 1. Calculate scores via Enhanced GradingService
    const gradingResults =
      await this.gradingService.calculateAttemptScore(attemptId);

    if (!gradingResults) {
      throw new BadRequestException('Failed to grade attempt');
    }

    // 2. Transactional Update with all analytics + optimistic concurrency check inside
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Double check status inside transaction to prevent race conditions
        const currentAttempt = await tx.testAttempt.findUnique({
          where: { id: attemptId }
        });

        if (currentAttempt?.status !== AttemptStatus.ACTIVE) {
          return tx.testAttempt.findUnique({ where: { id: attemptId } });
        }

        // Compute totalTimeSpent = SUM of all per-question times
        const timeAgg = await tx.testAttemptQuestion.aggregate({
          where: { attemptId },
          _sum: { timeSpentSeconds: true },
        });
        const totalTimeSpent = timeAgg._sum.timeSpentSeconds ?? 0;

        await tx.testAttempt.update({
          where: { id: attemptId },
          data: {
            status: isAutoSubmit ? AttemptStatus.EXPIRED : AttemptStatus.COMPLETED,
            completedAt: new Date(),
            endedAt: new Date(),
            totalScore: gradingResults.totalScore,
            accuracy: gradingResults.accuracy,
            riskRatio: gradingResults.riskRatio,
            timeSpentSeconds: totalTimeSpent,
          },
        });

        // 3. Trigger Analytics Precomputation with grading results
        // (this also writes percentile + userRank onto the attempt record)
        await this.analyticsService.updateAll(tx, attemptId, gradingResults);

        // 4. Re-fetch the fully-updated attempt so percentile/rank are included
        return tx.testAttempt.findUnique({
          where: { id: attemptId },
          select: {
            id: true,
            testId: true,
            userId: true,
            status: true,
            startedAt: true,
            completedAt: true,
            totalScore: true,
            accuracy: true,
            percentile: true,
            userRank: true,
            timeSpentSeconds: true,
            riskRatio: true,
          },
        });
      },
      {
        timeout: 30000, // 30s for heavy analytics
        maxWait: 5000,
      },
    );

    // Call AI Analyze asynchronously (fire-and-forget)
    this.questionFetcher.analyzePerformance(attemptId).catch((err) => {
      console.error(
        `[TestLifecycleService] Failed to analyze performance for attempt ${attemptId}:`,
        err,
      );
    });

    return result;
  }

  async getAttemptReview(attemptId: string, userId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        testId: true,
        userId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        totalScore: true,
        accuracy: true,
        percentile: true,
        userRank: true,
        timeSpentSeconds: true,
        riskRatio: true,
        test: {
          select: {
            totalQuestions: true,
            totalMarks: true,
            threadId: true,
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');
    if (attempt.status !== AttemptStatus.COMPLETED) {
      throw new BadRequestException(
        'Attempt review is only available for completed attempts',
      );
    }

    // Fetch all TestQuestion entries for this test, with their attempt answers
    const testQuestions = await this.prisma.testQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        questionId: true,
        sequence: true,
        subject: true,
        topic: true,
        difficulty: true,
        questionType: true,
        contentSnapshot: true,
        correctAnswer: true,
        explanation: true,
        marks: true,
        negativeMarkValue: true,
        attemptQuestions: {
          where: { attemptId },
          select: {
            id: true,
            selectedAnswer: true,
            isCorrect: true,
            marksAwarded: true,
            timeSpentSeconds: true,
          },
        },
      },
    });

    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;

    const questions = testQuestions.map((tq) => {
      const aq = tq.attemptQuestions[0] ?? null;

      let status: 'CORRECT' | 'INCORRECT' | 'UNATTEMPTED';
      if (!aq || aq.selectedAnswer == null || aq.selectedAnswer.trim() === '') {
        status = 'UNATTEMPTED';
        unattempted++;
      } else if (aq.isCorrect) {
        status = 'CORRECT';
        correct++;
      } else {
        status = 'INCORRECT';
        incorrect++;
      }

      return {
        id: aq?.id ?? null,
        questionId: tq.questionId,
        sequence: tq.sequence,
        subject: tq.subject,
        topic: tq.topic,
        difficulty: tq.difficulty,
        questionType: tq.questionType,
        contentPayload: tq.contentSnapshot,
        marks: tq.marks,
        negativeMarkValue: tq.negativeMarkValue,
        selectedAnswer: aq?.selectedAnswer ?? null,
        correctAnswer: tq.correctAnswer,
        isCorrect: aq?.isCorrect ?? null,
        marksAwarded: aq?.marksAwarded ?? null,
        explanation: tq.explanation,
        timeSpentSeconds: aq?.timeSpentSeconds ?? null,
        status,
      };
    });

    const { test, userId: _uid, ...attemptData } = attempt;

    return {
      attempt: attemptData,
      summary: {
        totalQuestions: test.totalQuestions,
        attempted: correct + incorrect,
        correct,
        incorrect,
        unattempted,
        totalScore: attempt.totalScore,
        maxScore: test.totalMarks,
      },
      questions,
    };
  }
}
