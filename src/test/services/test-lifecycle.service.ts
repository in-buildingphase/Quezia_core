import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus, Prisma, TestStatus, UserRole } from '@prisma/client';
import { GradingService } from '../../result/services/grading.service';
import { AnalyticsService } from '../../result/services/analytics.service';
import { SubscriptionService } from '../../subscription/subscription.service';

@Injectable()
export class TestLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly analyticsService: AnalyticsService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

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
    if (attempt.userId !== userId) throw new ForbiddenException('Not your attempt');

    return attempt;
  }

  async getAttemptQuestions(attemptId: string, userId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, testId: true, userId: true },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId) throw new ForbiddenException('Not your attempt');

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
    questionId: string,
    answer: string,
    userId: string,
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
      },
      create: {
        attemptId,
        testQuestionId: testQuestion.id,
        selectedAnswer: answer,
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
    const gradingResults = await this.gradingService.calculateAttemptScore(attemptId);

    if (!gradingResults) {
      throw new BadRequestException('Failed to grade attempt');
    }

    // 2. Transactional Update with all analytics
    return this.prisma.$transaction(
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
  }
}
