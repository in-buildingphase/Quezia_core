import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateThreadDto } from '../dto/create-thread.dto';
import { Prisma, TestStatus, UserRole } from '@prisma/client';

type ThreadGenerationConfig = {
  subjects: Prisma.JsonValue | null;
  difficulty: Prisma.JsonValue | null;
};

type ThreadSummary = {
  id: string;
  examId: string;
  originType: string;
  createdByUserId: string | null;
  title: string;
  baseGenerationConfig: Prisma.JsonValue;
  createdAt: Date;
};

type SectionSnapshotSummary = {
  sectionId?: string;
  questionCount?: number;
  subject?: string;
};

@Injectable()
export class TestService {
  constructor(private readonly prisma: PrismaService) {}

  private isJsonObject(
    value: Prisma.JsonValue | null | undefined,
  ): value is Prisma.JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private readSectionSnapshots(
    value: Prisma.JsonValue,
  ): SectionSnapshotSummary[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return value
      .filter((entry): entry is Prisma.JsonObject => this.isJsonObject(entry))
      .map((entry) => ({
        sectionId:
          typeof entry.sectionId === 'string' ? entry.sectionId : undefined,
        questionCount:
          typeof entry.questionCount === 'number'
            ? entry.questionCount
            : undefined,
        subject: typeof entry.subject === 'string' ? entry.subject : undefined,
      }));
  }

  private toThreadSummary(thread: ThreadSummary) {
    return {
      id: thread.id,
      examId: thread.examId,
      originType: thread.originType,
      createdByUserId: thread.createdByUserId,
      title: thread.title,
      baseGenerationConfig: this.pickThreadGenerationConfig(
        thread.baseGenerationConfig,
      ),
      createdAt: thread.createdAt,
    };
  }

  private pickThreadGenerationConfig(
    baseGenerationConfig: Prisma.JsonValue,
  ): ThreadGenerationConfig {
    if (!this.isJsonObject(baseGenerationConfig)) {
      return {
        subjects: null,
        difficulty: null,
      };
    }

    return {
      subjects: baseGenerationConfig.subjects ?? null,
      difficulty: baseGenerationConfig.difficulty ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST: list by current user ownership
  // A user can only view tests from threads they created.
  // ─────────────────────────────────────────────────────────────────────────
  async getTestsByUser(userId: string) {
    return this.prisma.test.findMany({
      where: {
        thread: {
          createdByUserId: userId,
        },
      },
      select: {
        id: true,
        threadId: true,
        versionNumber: true,
        examId: true,
        status: true,
        totalQuestions: true,
        totalMarks: true,
        durationSeconds: true,
        createdAt: true,
        thread: {
          select: {
            id: true,
            title: true,
            originType: true,
            createdByUserId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THREAD: create
  // Locks if exam is inactive. Creator is null for SYSTEM-originated threads.
  // ─────────────────────────────────────────────────────────────────────────
  async createThread(dto: CreateThreadDto, userId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
    });
    if (!exam) {
      throw new NotFoundException(`Exam "${dto.examId}" not found`);
    }
    if (!exam.isActive) {
      throw new BadRequestException(
        `Exam "${exam.name}" is inactive. Cannot create test threads for inactive exams.`,
      );
    }

    return this.prisma.testThread.create({
      data: {
        examId: dto.examId,
        originType: dto.originType,
        title: dto.title,
        baseGenerationConfig:
          dto.baseGenerationConfig as Prisma.InputJsonObject,
        // Null for SYSTEM origin to express "no human creator"
        createdByUserId: dto.originType === 'SYSTEM' ? null : userId,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THREAD: list by user
  // ─────────────────────────────────────────────────────────────────────────
  async getThreadsByUser(userId: string, role: UserRole) {
    const query = {
      select: {
        id: true,
        examId: true,
        originType: true,
        createdByUserId: true,
        title: true,
        baseGenerationConfig: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' as const },
    };

    if (role === UserRole.ADMIN) {
      const threads = await this.prisma.testThread.findMany(query);
      return threads.map((thread) => this.toThreadSummary(thread));
    }

    const threads = await this.prisma.testThread.findMany({
      where: {
        createdByUserId: userId,
      },
      ...query,
    });

    return threads.map((thread) => this.toThreadSummary(thread));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THREAD: get by id (with version list)
  // ─────────────────────────────────────────────────────────────────────────
  async getThreadById(threadId: string, userId: string, role: UserRole) {
    const thread = await this.prisma.testThread.findUnique({
      where: { id: threadId },
      include: {
        exam: { select: { id: true, name: true, isActive: true } },
        tests: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            createdAt: true,
            totalQuestions: true,
            totalMarks: true,
            durationSeconds: true,
          },
          orderBy: { versionNumber: 'desc' },
        },
      },
    });

    if (!thread) {
      throw new NotFoundException(`Thread "${threadId}" not found`);
    }

    this.assertThreadOwnership(thread.createdByUserId, userId, role);
    return thread;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THREAD: get latest version
  // ─────────────────────────────────────────────────────────────────────────
  async getLatestVersion(threadId: string, userId: string, role: UserRole) {
    const thread = await this.getThreadById(threadId, userId, role);

    if (thread.tests.length === 0) {
      throw new NotFoundException('No versions found for this thread');
    }

    return thread.tests[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST: get full detail
  // ─────────────────────────────────────────────────────────────────────────
  async getTestById(testId: string, userId: string, role: UserRole) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: {
        thread: true,
        questions: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!test) {
      throw new NotFoundException(`Test "${testId}" not found`);
    }

    this.assertThreadOwnership(test.thread.createdByUserId, userId, role);
    return test;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST: PUBLISH  DRAFT → PUBLISHED
  // Enforces full structural integrity before allowing transition:
  //  1. Actual question count must equal test.totalQuestions
  //  2. Sum of snapshot marks must equal test.totalMarks
  //  3. Section distribution must match sectionSnapshot counts
  // ─────────────────────────────────────────────────────────────────────────
  async publishTest(testId: string, role: UserRole) {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can publish tests');
    }

    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: { questions: true },
    });

    if (!test) {
      throw new NotFoundException(`Test "${testId}" not found`);
    }

    if (test.status !== TestStatus.DRAFT) {
      throw new BadRequestException(
        `Only DRAFT tests can be published. Current status: ${test.status}`,
      );
    }

    const ruleSnapshot = this.isJsonObject(test.ruleSnapshot)
      ? test.ruleSnapshot
      : null;
    const sectionSnapshot = this.readSectionSnapshots(test.sectionSnapshot);
    const questions = test.questions;

    // ── Required snapshots must be present ──────────────────────────────
    if (!ruleSnapshot || !sectionSnapshot || !Array.isArray(sectionSnapshot)) {
      throw new BadRequestException(
        'Test is missing ruleSnapshot or sectionSnapshot — cannot publish',
      );
    }

    if (test.durationSeconds <= 0) {
      throw new BadRequestException('Test durationSeconds must be > 0');
    }

    // ── 1. Question count ────────────────────────────────────────────────
    const actualCount = questions.length;
    if (actualCount !== test.totalQuestions) {
      throw new BadRequestException(
        `Question count mismatch: declared totalQuestions=${test.totalQuestions} ` +
          `but actual snapshotted questions=${actualCount}. ` +
          'Inject the missing questions before publishing.',
      );
    }

    if (actualCount === 0) {
      throw new BadRequestException('Cannot publish a test with no questions');
    }

    // ── 2. Marks sum ─────────────────────────────────────────────────────
    const marksSum = questions.reduce((acc, q) => acc + Number(q.marks), 0);
    const declaredMarks = Number(test.totalMarks);
    if (Math.abs(marksSum - declaredMarks) > 0.001) {
      throw new BadRequestException(
        `Marks sum mismatch: declared totalMarks=${declaredMarks} ` +
          `but sum of question marks=${marksSum.toFixed(4)}. ` +
          'Fix question marks before publishing.',
      );
    }

    // ── 3. Section distribution ──────────────────────────────────────────
    for (const section of sectionSnapshot) {
      const sectionId = section.sectionId;
      const declared = section.questionCount as number;

      if (!sectionId || declared === undefined) continue; // skip untracked sections

      const actual = questions.filter((q) => q.sectionId === sectionId).length;
      if (actual !== declared) {
        throw new BadRequestException(
          `Section "${sectionId}" (subject: ${section.subject}) has ${actual} question(s) ` +
            `but sectionSnapshot declares ${declared}. ` +
            'Inject the correct number of questions per section.',
        );
      }
    }

    return this.prisma.test.update({
      where: { id: testId },
      data: { status: TestStatus.PUBLISHED },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST: ARCHIVE  PUBLISHED → ARCHIVED
  // ─────────────────────────────────────────────────────────────────────────
  async archiveTest(testId: string, role: UserRole) {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can archive tests');
    }

    const test = await this.prisma.test.findUnique({ where: { id: testId } });

    if (!test) throw new NotFoundException(`Test "${testId}" not found`);

    if (test.status !== TestStatus.PUBLISHED) {
      throw new BadRequestException('Only PUBLISHED tests can be archived');
    }

    return this.prisma.test.update({
      where: { id: testId },
      data: { status: TestStatus.ARCHIVED },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST: delete (constraint-guarded)
  // Refuses deletion if any COMPLETED attempts exist.
  // ─────────────────────────────────────────────────────────────────────────
  async deleteTest(
    testId: string,
    role: UserRole,
  ): Promise<{ message: string }> {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete tests');
    }
    const test = await this.prisma.test.findUnique({ where: { id: testId } });
    if (!test) throw new NotFoundException(`Test ${testId} not found`);

    const attemptCount = await this.prisma.testAttempt.count({
      where: { testId },
    });
    if (attemptCount > 0) {
      throw new BadRequestException(
        `Cannot delete test: ${attemptCount} attempt(s) exist. Archive the test instead.`,
      );
    }
    await this.prisma.test.delete({ where: { id: testId } });
    return { message: 'Test deleted successfully' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THREAD: delete (with cascading cleanup)
  // Learners can only delete their own GENERATED threads.
  // Admins can delete any thread.
  // Deleting a thread deletes all tests, attempts and their related questions/analytics.
  // ─────────────────────────────────────────────────────────────────────────
  async deleteThread(
    threadId: string,
    userId: string,
    role: UserRole,
  ): Promise<{ message: string }> {
    const thread = await this.prisma.testThread.findUnique({
      where: { id: threadId },
      include: { tests: { select: { id: true } } },
    });

    if (!thread) {
      throw new NotFoundException(`Thread "${threadId}" not found`);
    }

    // Ownership and Role gating
    if (role !== UserRole.ADMIN) {
      if (!thread.createdByUserId || thread.createdByUserId !== userId) {
        throw new ForbiddenException(
          'You do not have access to delete this thread',
        );
      }
      // System threads (createdByUserId: null) are not deletable by learners
      if (thread.createdByUserId === null) {
        throw new ForbiddenException('Cannot delete system threads');
      }
    }

    const testIds = thread.tests.map((t) => t.id);

    // Transactional deletion of all associations
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete PerformanceTrend records referencing these attempts
      await tx.performanceTrend.deleteMany({
        where: {
          attemptId: {
            in: (
              await tx.testAttempt.findMany({
                where: { testId: { in: testIds } },
                select: { id: true },
              })
            ).map((a) => a.id),
          },
        },
      });

      // 2. Delete the thread (cascades: Test → TestQuestion, TestAttempt → TestAttemptQuestion)
      await tx.testThread.delete({
        where: { id: threadId },
      });
    });

    return {
      message: 'Test thread and all associated data deleted successfully',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────
  private assertThreadOwnership(
    ownerId: string | null | undefined,
    requesterId: string,
    role: UserRole,
  ) {
    if (role === UserRole.ADMIN) return;
    if (ownerId && ownerId !== requesterId) {
      throw new ForbiddenException('You do not have access to this thread');
    }
  }
}
