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
    test: {
      threadId: string | null;
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

    return {
      id: attempt.id,
      testId: attempt.testId,
      threadId: attempt.test.threadId,
      userId: attempt.userId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      totalScore: attempt.totalScore,
      accuracy: attempt.accuracy,
      timeSpentSeconds: attempt.timeSpentSeconds,
      percentile: attempt.percentile,
      userRank: attempt.userRank,
      riskRatio: attempt.riskRatio,
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
        totalScore: true,
        accuracy: true,
        timeSpentSeconds: true,
        percentile: true,
        userRank: true,
        riskRatio: true,
        test: {
          select: {
            threadId: true,
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
        totalScore: true,
        accuracy: true,
        percentile: true,
        userRank: true,
        timeSpentSeconds: true,
        riskRatio: true,
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');

    return attempt;
  }

  async getAttemptQuestions(attemptId: string, userId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, testId: true, userId: true },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Not your attempt');

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

    // Expose the stored snapshot as `contentPayload` so the API contract
    // matches the Question registry field name.
    return questions.map(({ contentSnapshot, ...rest }) => ({
      ...rest,
      contentPayload: contentSnapshot,
    }));
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
      return await tryCreate();
    } catch (e: any) {
      // P2034: serialization failure — a concurrent tx won the race; return
      // whichever active attempt it created.
      if (e?.code === 'P2034') {
        const existing = await this.prisma.testAttempt.findFirst({
          where: { testId, userId, status: AttemptStatus.ACTIVE },
          select: ATTEMPT_SELECT,
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async submitAnswer(
    attemptId: string,
    dto: SubmitAnswerDto,
    userId: string,
  ) {
    const { questionId, answer, timeSpentSeconds, visitationData } = dto;

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
      throw new BadRequestException('Attempt is no longer active');
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
        ...(timeSpentSeconds !== undefined && { timeSpentSeconds }),
        ...(visitationData !== undefined && { visitationData }),
      },
      create: {
        attemptId,
        testQuestionId: testQuestion.id,
        selectedAnswer: answer,
        ...(timeSpentSeconds !== undefined && { timeSpentSeconds }),
        ...(visitationData !== undefined && { visitationData }),
      },
    });
  }

  async completeAttempt(attemptId: string, userId: string) {
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
      throw new BadRequestException('Attempt already completed');
    }

    // 1. Calculate scores via Enhanced GradingService
    const gradingResults =
      await this.gradingService.calculateAttemptScore(attemptId);

    if (!gradingResults) {
      throw new BadRequestException('Failed to grade attempt');
    }

    // 2. Transactional Update with all analytics
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.testAttempt.update({
          where: { id: attemptId },
          data: {
            status: AttemptStatus.COMPLETED,
            completedAt: new Date(),
            totalScore: gradingResults.totalScore,
            accuracy: gradingResults.accuracy,
            riskRatio: gradingResults.riskRatio,
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
