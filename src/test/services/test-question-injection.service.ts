import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionValidatorService, QuestionPayload } from '../../question/question-validator.service';
import { InjectQuestionsDto, InjectedQuestionItemDto } from '../dto/inject-questions.dto';
import { TestStatus, UserRole } from '@prisma/client';

@Injectable()
export class TestQuestionInjectionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly validator: QuestionValidatorService,
    ) { }

    // ─────────────────────────────────────────────────────────────────────────
    // INJECT: validate + snapshot questions into a DRAFT test
    // ─────────────────────────────────────────────────────────────────────────
    async injectQuestions(
        testId: string,
        dto: InjectQuestionsDto,
        userId: string,
        role: UserRole,
    ) {
        const test = await this.prisma.test.findUnique({
            where: { id: testId },
            include: {
                thread: true,
                questions: { select: { questionId: true, sequence: true } },
                attempts: { select: { id: true, status: true } },
            },
        });

        if (!test) throw new NotFoundException(`Test "${testId}" not found`);

        // ─── Ownership ───────────────────────────────────────────────────────
        this.assertOwnership(test.thread.createdByUserId, userId, role);

        // ─── Immutability: only DRAFT tests accept question injection ─────────
        if (test.status !== TestStatus.DRAFT) {
            throw new BadRequestException(
                `Cannot inject questions into a test with status "${test.status}". ` +
                'Only DRAFT tests accept new questions.',
            );
        }

        // ─── Guard: reject structural edits after first COMPLETED attempt ─────
        const hasCompletedAttempt = test.attempts.some(
            (a) => a.status === 'COMPLETED',
        );
        if (hasCompletedAttempt) {
            throw new BadRequestException(
                'Structural edits are forbidden once a completed attempt exists. ' +
                'Create a new Test version under the same TestThread instead.',
            );
        }

        const sectionSnapshot = test.sectionSnapshot as any[];
        const ruleSnapshot = test.ruleSnapshot as any;

        // ─── Collect existing questionIds already in this test ────────────────
        const existingIds = test.questions.map((q) => q.questionId);
        let nextSequence = test.questions.length > 0
            ? Math.max(...test.questions.map((q) => q.sequence)) + 1
            : 1;

        // ─── Validate section exists in snapshot ──────────────────────────────
        const section = sectionSnapshot.find((s: any) => s.sectionId === dto.sectionId);
        if (!section) {
            throw new BadRequestException(
                `Section "${dto.sectionId}" is not in this test's sectionSnapshot`,
            );
        }

        const created: any[] = [];

        for (const item of dto.questions) {
            // Full structural + content validation
            const payload: QuestionPayload = {
                questionId: item.questionId,
                questionType: item.questionType,
                subject: item.subject,
                topic: item.topic,
                subtopic: item.subtopic,
                difficulty: item.difficulty,
                marks: item.marks,
                defaultTimeSeconds: item.defaultTimeSeconds,
                correctAnswer: item.correctAnswer,
                explanation: item.explanation,
                numericTolerance: item.numericTolerance,
                contentPayload: item.contentPayload as any,
            };

            this.validator.validateFull(payload);

            // Cross-test contamination + metadata consistency against snapshot
            // Pass a running set so duplicates within the same batch are caught too
            this.validator.validateAgainstTestSnapshot(
                payload,
                sectionSnapshot,
                ruleSnapshot,
                dto.sectionId,
                existingIds,
            );

            // Track immediately so within-batch duplicates are also rejected
            existingIds.push(item.questionId);

            // ─── Snapshot into TestQuestion ───────────────────────────────────
            const snapshot = await this.prisma.testQuestion.create({
                data: {
                    testId,
                    questionId: item.questionId,
                    sectionId: dto.sectionId,
                    subject: item.subject,
                    topic: item.topic,
                    subtopic: item.subtopic,
                    difficulty: item.difficulty,
                    questionType: item.questionType,
                    contentSnapshot: item.contentPayload,
                    correctAnswer: item.correctAnswer,
                    explanation: item.explanation,
                    marks: item.marks,
                    negativeMarkValue: item.negativeMarkValue ?? null,
                    tolerance: item.numericTolerance ?? null,
                    sequence: nextSequence++,
                },
            });

            created.push(snapshot);
        }

        return {
            testId,
            sectionId: dto.sectionId,
            injectedCount: created.length,
            questions: created,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIST: return all snapshots for a test (ordered by sequence)
    // ─────────────────────────────────────────────────────────────────────────
    async getTestQuestions(testId: string, userId: string, role: UserRole) {
        const test = await this.prisma.test.findUnique({
            where: { id: testId },
            include: { thread: { select: { createdByUserId: true } } },
        });

        if (!test) throw new NotFoundException(`Test "${testId}" not found`);
        this.assertOwnership(test.thread.createdByUserId, userId, role);

        return this.prisma.testQuestion.findMany({
            where: { testId },
            orderBy: { sequence: 'asc' },
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REMOVE: remove a snapshot from a DRAFT test (no completed attempts)
    // ─────────────────────────────────────────────────────────────────────────
    async removeQuestionSnapshot(
        testId: string,
        testQuestionId: string,
        userId: string,
        role: UserRole,
    ) {
        const test = await this.prisma.test.findUnique({
            where: { id: testId },
            include: {
                thread: { select: { createdByUserId: true } },
                attempts: { select: { status: true } },
            },
        });

        if (!test) throw new NotFoundException(`Test "${testId}" not found`);
        this.assertOwnership(test.thread.createdByUserId, userId, role);

        if (test.status !== TestStatus.DRAFT) {
            throw new BadRequestException(
                `Cannot remove questions from a "${test.status}" test. Only DRAFT tests can be modified.`,
            );
        }

        const hasCompleted = test.attempts.some((a) => a.status === 'COMPLETED');
        if (hasCompleted) {
            throw new BadRequestException(
                'Cannot remove questions after a completed attempt exists. Create a new test version.',
            );
        }

        const tq = await this.prisma.testQuestion.findFirst({
            where: { id: testQuestionId, testId },
        });

        if (!tq) {
            throw new NotFoundException(
                `TestQuestion "${testQuestionId}" not found in test "${testId}"`,
            );
        }

        await this.prisma.testQuestion.delete({ where: { id: testQuestionId } });

        // Compact sequences to stay contiguous
        await this.resequenceAfterDelete(testId);

        return { removed: testQuestionId };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REORDER: set explicit order for questions in a DRAFT test
    // orderedIds: array of TestQuestion.id strings in desired order
    // ─────────────────────────────────────────────────────────────────────────
    async reorderQuestions(
        testId: string,
        orderedIds: string[],
        userId: string,
        role: UserRole,
    ) {
        const test = await this.prisma.test.findUnique({
            where: { id: testId },
            include: {
                thread: { select: { createdByUserId: true } },
                questions: { select: { id: true } },
                attempts: { select: { status: true } },
            },
        });

        if (!test) throw new NotFoundException(`Test "${testId}" not found`);
        this.assertOwnership(test.thread.createdByUserId, userId, role);

        if (test.status !== TestStatus.DRAFT) {
            throw new BadRequestException(
                `Cannot reorder questions in a "${test.status}" test. Only DRAFT tests allow ordering changes.`,
            );
        }

        const hasCompleted = test.attempts.some((a) => a.status === 'COMPLETED');
        if (hasCompleted) {
            throw new BadRequestException(
                'Cannot reorder questions after a completed attempt exists.',
            );
        }

        const existingIds = new Set(test.questions.map((q) => q.id));
        if (orderedIds.length !== existingIds.size) {
            throw new BadRequestException(
                `orderedIds length (${orderedIds.length}) does not match total questions in test (${existingIds.size})`,
            );
        }

        for (const id of orderedIds) {
            if (!existingIds.has(id)) {
                throw new BadRequestException(
                    `TestQuestion "${id}" is not part of test "${testId}"`,
                );
            }
        }

        // Apply new sequences in a transaction
        await this.prisma.$transaction(
            orderedIds.map((id, index) =>
                this.prisma.testQuestion.update({
                    where: { id },
                    data: { sequence: index + 1 },
                }),
            ),
        );

        return { reordered: true, count: orderedIds.length };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────
    private assertOwnership(
        ownerId: string | null | undefined,
        requesterId: string,
        role: UserRole,
    ) {
        if (role === UserRole.ADMIN) return;
        if (ownerId && ownerId !== requesterId) {
            throw new ForbiddenException('You do not have access to this test');
        }
    }

    private async resequenceAfterDelete(testId: string) {
        const remaining = await this.prisma.testQuestion.findMany({
            where: { testId },
            orderBy: { sequence: 'asc' },
            select: { id: true },
        });

        // If no questions remain, skip resequencing
        if (remaining.length === 0) {
            return;
        }

        // Use raw SQL for efficient batch update to avoid transaction timeout
        // This is much faster than individual updates in a transaction
        const updates = remaining
            .map((q, index) => `UPDATE "TestQuestion" SET sequence = ${index + 1} WHERE id = '${q.id}'`)
            .join(';\n');

        if (updates) {
            await this.prisma.$executeRawUnsafe(updates);
        }
    }
}
