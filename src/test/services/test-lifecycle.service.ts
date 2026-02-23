import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus, TestStatus, UserRole } from '@prisma/client';
import { GradingService } from '../../result/services/grading.service';
import { AnalyticsService } from '../../result/services/analytics.service';

@Injectable()
export class TestLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async getAttemptQuestions(attemptId: string, userId: string) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, testId: true, userId: true },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId) throw new ForbiddenException('Not your attempt');

    return this.prisma.testQuestion.findMany({
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
  }

  async startAttempt(testId: string, userId: string) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: { questions: true },
    });

    if (!test) throw new NotFoundException('Test not found');
    if (test.status !== TestStatus.PUBLISHED) {
      throw new BadRequestException(
        'Cannot start attempt on a non-published test',
      );
    }

    // Check if there is already an active attempt
    const activeAttempt = await this.prisma.testAttempt.findFirst({
      where: { testId, userId, status: AttemptStatus.ACTIVE },
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

    if (activeAttempt) return activeAttempt;

    return this.prisma.testAttempt.create({
      data: {
        testId,
        userId,
        status: AttemptStatus.ACTIVE,
        startedAt: new Date(),
      },
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
