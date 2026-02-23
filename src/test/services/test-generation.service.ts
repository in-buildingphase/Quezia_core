import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamService } from '../../exam/exam.service';
import { GenerateTestDto } from '../dto/generate-test.dto';
import { RegenerateTestDto } from '../dto/regenerate-test.dto';
import { TestStatus, UserRole, Question, TestThread, Test } from '@prisma/client';
import { QuestionService } from '../../question/question.service';

interface SectionSnapshot {
    sectionId: string;
    subject: string;
    sequence: number;
    sectionDurationSeconds: number | null;
    questionCount: number;
    marksPerQuestion: number;
}

@Injectable()
export class TestGenerationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly examService: ExamService,
        private readonly questionService: QuestionService,
    ) { }

    async generateInitial(threadId: string, dto: GenerateTestDto, userId: string, role: UserRole) {
        const thread = await this.prisma.testThread.findUnique({
            where: { id: threadId },
            include: { tests: true, exam: true },
        });

        if (!thread) throw new NotFoundException(`Thread "${threadId}" not found`);

        // ── Thread lock: exam must be active ──────────────────────────────────
        if (!thread.exam.isActive) {
            throw new BadRequestException(
                `Exam "${thread.exam.name}" is inactive. Cannot generate test versions for inactive exams.`,
            );
        }

        if (thread.tests.length > 0) {
            throw new BadRequestException('Thread already has an initial version. Use regenerate instead.');
        }

        if (role !== UserRole.ADMIN && thread.createdByUserId && thread.createdByUserId !== userId) {
            throw new ForbiddenException('You do not have access to this thread');
        }

        return this.createVersion(thread as any, 1, dto.followsBlueprint ?? true, dto.blueprintReferenceId);
    }

    async regenerate(threadId: string, dto: RegenerateTestDto, userId: string, role: UserRole) {
        const thread = await this.prisma.testThread.findUnique({
            where: { id: threadId },
            include: { tests: { orderBy: { versionNumber: 'desc' }, take: 1 }, exam: true },
        });

        if (!thread) throw new NotFoundException(`Thread "${threadId}" not found`);

        // ── Thread lock: exam must be active ──────────────────────────────────
        if (!thread.exam.isActive) {
            throw new BadRequestException(
                `Exam "${thread.exam.name}" is inactive. Cannot generate new test versions.`,
            );
        }

        if (thread.tests.length === 0) {
            throw new BadRequestException('Thread has no initial version. Use generate instead.');
        }

        if (role !== UserRole.ADMIN && thread.createdByUserId && thread.createdByUserId !== userId) {
            throw new ForbiddenException('You do not have access to this thread');
        }

        const latestVersion = thread.tests[0];
        const newVersionNumber = latestVersion.versionNumber + 1;

        return this.createVersion(thread as any, newVersionNumber, latestVersion.followsBlueprint, latestVersion.blueprintReferenceId ?? undefined);
    }

    private async createVersion(
        thread: TestThread & { tests: Test[] },
        versionNumber: number,
        followsBlueprint: boolean,
        blueprintId?: string,
    ) {
        let ruleSnapshot: any = {};
        let sectionSnapshot: SectionSnapshot[] = [];
        let durationSeconds = 0;
        let totalQuestions = 0;
        let totalMarks = 0;
        const questionsBySection: Map<string, Question[]> = new Map();

        const config = (thread.baseGenerationConfig as any) || {};
        const requestedDifficulty = config.difficulty || 'MIXED';
        const difficultyDistribution = config.difficultyDistribution ||
            (requestedDifficulty === 'MIXED' ? { easy: 10, medium: 10, hard: 10 } :
                requestedDifficulty === 'EASY' ? { easy: 25, medium: 5, hard: 0 } :
                    requestedDifficulty === 'MEDIUM' ? { easy: 5, medium: 20, hard: 5 } :
                        { easy: 0, medium: 5, hard: 25 });

        if (followsBlueprint) {
            const blueprint = blueprintId
                ? await this.examService.getBlueprintById(blueprintId)
                : await this.examService.getActiveBlueprint(thread.examId);

            if (!blueprint) {
                throw new BadRequestException('No active blueprint found for this exam');
            }

            ruleSnapshot = blueprint.rules[0] || {};
            const deterministicSeed = `${thread.id}-${versionNumber}`;

            sectionSnapshot = await Promise.all(blueprint.sections.map(async (s) => {
                const questionCount = 30;

                const selected = await this.questionService.selectQuestions({
                    examId: thread.examId,
                    deterministicSeed,
                    totalRequired: questionCount,
                    excludeQuestionIds: [],
                    filters: {
                        subjects: [{
                            name: s.subject,
                            topics: config.topics || [],
                            difficultyDistribution: difficultyDistribution,
                        }],
                    },
                });

                questionsBySection.set(s.id, selected);

                return {
                    sectionId: s.id,
                    subject: s.subject,
                    sequence: s.sequence,
                    sectionDurationSeconds: s.sectionDurationSeconds,
                    questionCount: selected.length,
                    marksPerQuestion: 4,
                } as SectionSnapshot;
            }));

            for (const section of sectionSnapshot) {
                totalQuestions += section.questionCount;
                totalMarks += section.questionCount * section.marksPerQuestion;
            }

            durationSeconds = blueprint.defaultDurationSeconds;
            blueprintId = blueprint.id;
        } else {
            durationSeconds = config.durationSeconds || 3600;
            totalQuestions = config.questionCount || 0;
        }

        // ── Create the immutable Test record ──────────────────────────────────
        const test = await this.prisma.test.create({
            data: {
                threadId: thread.id,
                versionNumber,
                examId: thread.examId,
                blueprintReferenceId: blueprintId,
                durationSeconds,
                totalQuestions,
                totalMarks,
                ruleSnapshot: ruleSnapshot as any,
                sectionSnapshot: sectionSnapshot as any,
                followsBlueprint,
                difficulty: requestedDifficulty as any,
                status: TestStatus.DRAFT,
            },
        });

        // ── Snapshot questions with sectionId ─────────────────────────────────
        let sequence = 1;
        for (const [sectionId, questions] of questionsBySection.entries()) {
            for (const q of questions) {
                await this.prisma.testQuestion.create({
                    data: {
                        testId: test.id,
                        questionId: q.questionId,
                        sectionId,
                        subject: q.subject,
                        topic: q.topic,
                        subtopic: q.subtopic,
                        difficulty: q.difficulty,
                        questionType: q.questionType,
                        contentSnapshot: q.contentPayload as any,
                        correctAnswer: q.correctAnswer,
                        explanation: q.explanation,
                        marks: q.marks,
                        negativeMarkValue: null,
                        tolerance: q.numericTolerance,
                        sequence: sequence++,
                    },
                });
            }
        }

        return test;
    }
}

