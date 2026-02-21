import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus, TestStatus, UserRole } from '@prisma/client';
import { GradingService } from '../../result/services/grading.service';

@Injectable()
export class TestLifecycleService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly gradingService: GradingService,
    ) { }

    async startAttempt(testId: string, userId: string) {
        const test = await this.prisma.test.findUnique({
            where: { id: testId },
            include: { questions: true },
        });

        if (!test) throw new NotFoundException('Test not found');
        if (test.status !== TestStatus.PUBLISHED) {
            throw new BadRequestException('Cannot start attempt on a non-published test');
        }

        // Check if there is already an active attempt
        const activeAttempt = await this.prisma.testAttempt.findFirst({
            where: { testId, userId, status: AttemptStatus.ACTIVE },
        });

        if (activeAttempt) return activeAttempt;

        return this.prisma.testAttempt.create({
            data: {
                testId,
                userId,
                status: AttemptStatus.ACTIVE,
                startedAt: new Date(),
            },
        });
    }

    async submitAnswer(attemptId: string, questionId: string, answer: string, userId: string) {
        const attempt = await this.prisma.testAttempt.findUnique({
            where: { id: attemptId },
        });

        if (!attempt) throw new NotFoundException('Attempt not found');
        if (attempt.userId !== userId) throw new ForbiddenException('Not your attempt');
        if (attempt.status !== AttemptStatus.ACTIVE) {
            throw new BadRequestException('Attempt is no longer active');
        }

        const testQuestion = await this.prisma.testQuestion.findFirst({
            where: { testId: attempt.testId, questionId },
        });

        if (!testQuestion) throw new NotFoundException('Question not found in this test');

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
        });

        if (!attempt) throw new NotFoundException('Attempt not found');
        if (attempt.userId !== userId) throw new ForbiddenException('Not your attempt');
        if (attempt.status !== AttemptStatus.ACTIVE) {
            throw new BadRequestException('Attempt already completed');
        }

        // Calculate scores via GradingService
        const results = await this.gradingService.calculateAttemptScore(attemptId);

        return this.prisma.testAttempt.update({
            where: { id: attemptId },
            data: {
                status: AttemptStatus.COMPLETED,
                completedAt: new Date(),
                totalScore: results?.totalScore,
                accuracy: results?.accuracy,
            },
        });
    }
}
