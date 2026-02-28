import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamService } from '../../exam/exam.service';
import { GenerateTestDto } from '../dto/generate-test.dto';
import { RegenerateTestDto } from '../dto/regenerate-test.dto';
import { TestStatus, UserRole, TestThread, Test } from '@prisma/client';
import { QuestionFetcherService } from './question-fetcher.service';
import { ExternalQuestionDto } from '../../question/dto/fetch-question.dto';

interface SectionSnapshot {
    sectionId: string;
    subject: string;
    sequence: number;
    sectionDurationSeconds: number | null;
    questionCount: number;
    marksPerQuestion: number;
}

type AnyQuestion = ExternalQuestionDto;

@Injectable()
export class TestGenerationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly examService: ExamService,
        private readonly questionFetcher: QuestionFetcherService,
    ) { }

    async generateInitial(
        threadId: string,
        dto: GenerateTestDto,
        userId: string,
        role: UserRole,
    ) {
        const thread = await this.prisma.testThread.findUnique({
            where: { id: threadId },
            include: { tests: true, exam: true },
        });

        if (!thread) throw new NotFoundException(`Thread "${threadId}" not found`);

        // ── Thread lock: exam must be active ────────────────────────────────────
        if (!thread.exam.isActive) {
            throw new BadRequestException(
                `Exam "${thread.exam.name}" is inactive. Cannot generate test versions for inactive exams.`,
            );
        }

        if (thread.tests.length > 0) {
            throw new BadRequestException(
                'Thread already has an initial version. Use regenerate instead.',
            );
        }

        if (
            role !== UserRole.ADMIN &&
            thread.createdByUserId &&
            thread.createdByUserId !== userId
        ) {
            throw new ForbiddenException('You do not have access to this thread');
        }

        return this.createVersion(
            thread as any,
            1,
            dto.followsBlueprint ?? true,
            dto.blueprintReferenceId,
            userId,
        );
    }

    async regenerate(
        threadId: string,
        dto: RegenerateTestDto,
        userId: string,
        role: UserRole,
    ) {
        const thread = await this.prisma.testThread.findUnique({
            where: { id: threadId },
            include: {
                tests: { orderBy: { versionNumber: 'desc' }, take: 1 },
                exam: true,
            },
        });

        if (!thread) throw new NotFoundException(`Thread "${threadId}" not found`);

        // ── Thread lock: exam must be active ────────────────────────────────────
        if (!thread.exam.isActive) {
            throw new BadRequestException(
                `Exam "${thread.exam.name}" is inactive. Cannot generate new test versions.`,
            );
        }

        if (thread.tests.length === 0) {
            throw new BadRequestException(
                'Thread has no initial version. Use generate instead.',
            );
        }

        if (
            role !== UserRole.ADMIN &&
            thread.createdByUserId &&
            thread.createdByUserId !== userId
        ) {
            throw new ForbiddenException('You do not have access to this thread');
        }

        const latestVersion = thread.tests[0];
        const newVersionNumber = latestVersion.versionNumber + 1;

        return this.createVersion(
            thread as any,
            newVersionNumber,
            latestVersion.followsBlueprint,
            latestVersion.blueprintReferenceId ?? undefined,
            userId,
        );
    }

    private async createVersion(
        thread: TestThread & { tests: Test[] },
        versionNumber: number,
        followsBlueprint: boolean,
        blueprintId?: string,
        userId?: string,
    ) {
        let ruleSnapshot: any = {};
        let sectionSnapshot: SectionSnapshot[] = [];
        let durationSeconds = 0;
        let totalQuestions = 0;
        let totalMarks = 0;
        const questionsBySection: Map<string, AnyQuestion[]> = new Map();

        let userProfile: any = null;
        if (userId) {
            userProfile = await this.prisma.userProfile.findUnique({
                where: { userId },
            });
        }

        const config = (thread.baseGenerationConfig as any) || {};
        const requestedDifficulty = config.difficulty || userProfile?.preferredDifficultyBias || 'MIXED';
        const difficultyDistribution =
            config.difficultyDistribution ||
            (requestedDifficulty === 'MIXED'
                ? { easy: 10, medium: 10, hard: 10 }
                : requestedDifficulty === 'EASY'
                    ? { easy: 25, medium: 5, hard: 0 }
                    : requestedDifficulty === 'MEDIUM'
                        ? { easy: 5, medium: 20, hard: 5 }
                        : { easy: 0, medium: 5, hard: 25 });

        if (followsBlueprint) {
            const blueprint = blueprintId
                ? await this.examService.getBlueprintById(blueprintId)
                : await this.examService.getActiveBlueprint(thread.examId);

            if (!blueprint) {
                throw new BadRequestException(
                    'No active blueprint found for this exam',
                );
            }

            ruleSnapshot = blueprint.rules[0] || {};
            const deterministicSeed = `${thread.id}-${versionNumber}`;

            // Cross-section deduplication: track all selected questionIds across sections
            const globalExcludeIds: string[] = [];

            if (versionNumber > 1) {
                const pastQuestions = await this.prisma.testQuestion.findMany({
                    where: { test: { threadId: thread.id } },
                    select: { questionId: true },
                });
                pastQuestions.forEach((q) => globalExcludeIds.push(q.questionId));
            }

            sectionSnapshot = [];
            for (const s of blueprint.sections) {
                // Use blueprint-defined counts; fall back to defaults only if absent
                const questionCount = (s as any).questionCount ?? 30;
                const marksPerQuestion = Number((s as any).marksPerQuestion ?? 4);

                let selected: AnyQuestion[];

                // All question fetching goes through the external Question Service.
                // If QUESTION_SERVICE_URL is not set the fetcher will throw
                // ServiceUnavailableException — that is intentional in production.
                selected = await this.questionFetcher.fetchQuestions({
                    userId: userId ?? thread.examId,
                    subject: s.subject,
                    difficulty: requestedDifficulty,
                    count: questionCount,
                    excludeQuestionIds: [...globalExcludeIds],
                });

                // Add selected questionIds to the global exclusion set
                selected.forEach((q) => globalExcludeIds.push(q.questionId));

                questionsBySection.set(s.id, selected);

                sectionSnapshot.push({
                    sectionId: s.id,
                    subject: s.subject,
                    sequence: s.sequence,
                    sectionDurationSeconds: s.sectionDurationSeconds,
                    questionCount: selected.length,
                    marksPerQuestion,
                } as SectionSnapshot);
            }

            for (const section of sectionSnapshot) {
                totalQuestions += section.questionCount;
                totalMarks += section.questionCount * section.marksPerQuestion;
            }

            durationSeconds = blueprint.defaultDurationSeconds;
            blueprintId = blueprint.id;
        } else {
            durationSeconds = config.durationSeconds || 3600;
            totalQuestions = config.questionCount || 0;

            if (thread.originType === 'GENERATED' && totalQuestions > 0) {
                // Determine a valid AI subject, default to Physics instead of General
                const subject = config.subject || 'Physics';
                const prompt = config.prompt;

                const selected = await this.questionFetcher.fetchQuestions({
                    userId: userId ?? thread.examId,
                    subject,
                    difficulty: requestedDifficulty,
                    count: totalQuestions,
                    prompt,
                    excludeQuestionIds: [],
                });

                // Re-calculate based on what AI actually returned
                totalQuestions = selected.length;
                totalMarks = selected.reduce((acc, q) => acc + (q.marks || 4), 0);
                const generatedSectionId = 'ai-generated-section';

                questionsBySection.set(generatedSectionId, selected);

                sectionSnapshot.push({
                    sectionId: generatedSectionId,
                    subject,
                    sequence: 1,
                    sectionDurationSeconds: durationSeconds,
                    questionCount: selected.length,
                    marksPerQuestion: selected.length > 0 ? selected[0].marks : 4,
                } as SectionSnapshot);
            } else {
                // Provide a default empty section for SYSTEM test shells
                // so that scripts/manual processes can inject questions.
                const defaultSectionId = 'default-section';
                sectionSnapshot.push({
                    sectionId: defaultSectionId,
                    subject: config.subject || 'General',
                    sequence: 1,
                    sectionDurationSeconds: durationSeconds,
                    questionCount: totalQuestions,
                    marksPerQuestion: 4,
                } as SectionSnapshot);
                // Compute total marks to match the default section marksPerQuestion
                totalMarks = totalQuestions * 4;
            }
        }

        // ── Fail-fast: refuse a blueprint-driven test with zero questions ──
        if (followsBlueprint && totalQuestions === 0) {
            throw new BadRequestException(
                'Question service returned zero questions for all blueprint sections. ' +
                'Cannot create an empty test. Verify the AI service is returning results.',
            );
        }

        // ── Create the immutable Test record atomically ─────────────────────────
        const test = await this.prisma.$transaction(async (tx) => {
            const createdTest = await tx.test.create({
                data: {
                    threadId: thread.id,
                    versionNumber,
                    examId: thread.examId,
                    blueprintReferenceId: blueprintId,
                    durationSeconds,
                    totalQuestions,
                    totalMarks,
                    ruleSnapshot: ruleSnapshot,
                    sectionSnapshot: sectionSnapshot as any,
                    followsBlueprint,
                    difficulty: requestedDifficulty,
                    status:
                        thread.originType === 'GENERATED'
                            ? TestStatus.PUBLISHED
                            : TestStatus.DRAFT,
                },
            });

            // ── Snapshot questions with sectionId ─────────────────────────────────
            let sequence = 1;
            for (const [sectionId, questions] of questionsBySection.entries()) {
                for (const q of questions) {
                    await tx.testQuestion.create({
                        data: {
                            testId: createdTest.id,
                            questionId: q.questionId,
                            sectionId,
                            subject: q.subject,
                            topic: q.topic ?? '',
                            subtopic: q.subtopic ?? '',
                            difficulty: q.difficulty,
                            questionType: q.questionType,
                            contentSnapshot: (q as any).contentPayload,
                            correctAnswer: q.correctAnswer,
                            explanation: q.explanation,
                            marks: q.marks,
                            negativeMarkValue: null,
                            tolerance: (q as any).numericTolerance ?? null,
                            timeSeconds: (q as any).defaultTimeSeconds ?? null,
                            sequence: sequence++,
                        },
                    });
                }
            }

            return createdTest;
        }, { timeout: 60000 });

        return test;
    }
}
