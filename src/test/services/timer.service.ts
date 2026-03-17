import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptStatus } from '@prisma/client';
import { UpdateTimeDto } from '../dto/update-time.dto';
import { TestLifecycleService } from './test-lifecycle.service';

// Minimum interval between time updates for the same question (ms)
const MIN_UPDATE_INTERVAL_MS = 2000;

@Injectable()
export class TimerService {
    // In-memory rate-limit map: "attemptId:questionId" → last update timestamp
    private readonly lastUpdateMap = new Map<string, number>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly testLifecycleService: TestLifecycleService,
    ) { }

    async updateQuestionTime(
        attemptId: string,
        userId: string,
        dto: UpdateTimeDto,
    ) {
        const { questionId, deltaTime, isNewVisit } = dto;

        // ── 1. Attempt validation ─────────────────────────────────────────────
        const attempt = await this.prisma.testAttempt.findUnique({
            where: { id: attemptId },
            select: {
                id: true,
                testId: true,
                userId: true,
                status: true,
                startedAt: true,
                test: {
                    select: { durationSeconds: true }
                }
            },
        });

        if (!attempt) throw new NotFoundException('Attempt not found');
        if (attempt.userId !== userId)
            throw new ForbiddenException('Not your attempt');
        if (attempt.status !== AttemptStatus.ACTIVE) {
            throw new BadRequestException('Attempt is no longer active');
        }

        const nowClass = new Date();
        const elapsedSeconds = (nowClass.getTime() - attempt.startedAt.getTime()) / 1000;

        // Strict cutoff: if time is up, trigger auto-submit for the test
        if (elapsedSeconds >= attempt.test.durationSeconds) {
            await this.testLifecycleService.completeAttempt(attempt.id, userId, true);
            throw new BadRequestException('Test auto-submitted due to timeout');
        }

        // Soft cutoff fallback
        if (elapsedSeconds > attempt.test.durationSeconds + 30) {
            throw new BadRequestException('Test time has expired');
        }

        // ── 2. Anti-cheat: deltaTime validation ───────────────────────────────
        // Class-validator handles ≤0 and >30000, but defence-in-depth:
        if (deltaTime <= 0 || deltaTime > 30000) {
            throw new BadRequestException(
                'deltaTime must be between 1 and 30000 ms',
            );
        }

        // ── 3. Rate limiting ──────────────────────────────────────────────────
        const rateKey = `${attemptId}:${questionId}`;
        const now = Date.now();
        const lastUpdate = this.lastUpdateMap.get(rateKey);
        if (lastUpdate && now - lastUpdate < MIN_UPDATE_INTERVAL_MS) {
            throw new BadRequestException('Too many time updates — try again later');
        }
        this.lastUpdateMap.set(rateKey, now);

        // ── 4. Question ownership ─────────────────────────────────────────────
        const testQuestion = await this.prisma.testQuestion.findFirst({
            where: { testId: attempt.testId, questionId },
            select: { id: true },
        });

        if (!testQuestion) {
            throw new NotFoundException('Question not found in this test');
        }

        // ── 5. Atomic upsert via INSERT ... ON CONFLICT DO UPDATE ─────────────
        const deltaSeconds = Math.round(deltaTime / 1000);
        const visitIncrement = isNewVisit ? 1 : 0;

        const result = await this.prisma.$queryRawUnsafe<
            { timeSpentSeconds: number; visitCount: number }[]
        >(
            `INSERT INTO "TestAttemptQuestion" (
        "id", "attemptId", "testQuestionId",
        "timeSpentSeconds", "visitCount", "lastVisitedAt"
      )
      VALUES (
        gen_random_uuid(), $1, $2,
        $3, $4, NOW()
      )
      ON CONFLICT ("attemptId", "testQuestionId")
      DO UPDATE SET
        "timeSpentSeconds" = COALESCE("TestAttemptQuestion"."timeSpentSeconds", 0) + $3,
        "visitCount" = "TestAttemptQuestion"."visitCount" + $4,
        "lastVisitedAt" = NOW()
      RETURNING "timeSpentSeconds", "visitCount"`,
            attemptId,
            testQuestion.id,
            deltaSeconds,
            visitIncrement,
        );

        const updated = result[0];

        // ── 5.5. Update heartbeat ─────────────────────────────────────────────
        await this.prisma.testAttempt.update({
            where: { id: attemptId },
            data: { lastHeartbeatAt: new Date() }
        }).catch(err => {
            console.error(`[TimerService] Failed to update heartbeat for attempt ${attemptId}`, err);
        });

        // ── 6. Compute total attempt time ─────────────────────────────────────
        const totalAgg = await this.prisma.testAttemptQuestion.aggregate({
            where: { attemptId },
            _sum: { timeSpentSeconds: true },
        });
        const totalAttemptTime = totalAgg._sum.timeSpentSeconds ?? 0;

        return {
            questionTime: updated.timeSpentSeconds,
            visitCount: updated.visitCount,
            totalAttemptTime,
        };
    }

    /**
     * Clean up rate-limit entries for a completed attempt.
     * Called after submission to prevent memory leaks.
     */
    cleanupAttempt(attemptId: string) {
        for (const key of this.lastUpdateMap.keys()) {
            if (key.startsWith(`${attemptId}:`)) {
                this.lastUpdateMap.delete(key);
            }
        }
    }
}
