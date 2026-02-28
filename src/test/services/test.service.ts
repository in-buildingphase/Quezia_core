import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateThreadDto } from '../dto/create-thread.dto';
import { TestStatus, UserRole } from '@prisma/client';

@Injectable()
export class TestService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // THREAD: create
  // Locks if exam is inactive. Creator is null for SYSTEM-originated threads.
  // ─────────────────────────────────────────────────────────────────────────
  async createThread(dto: CreateThreadDto, userId: string, role: UserRole) {
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
        baseGenerationConfig: dto.baseGenerationConfig,
        // Null for SYSTEM origin to express "no human creator"
        createdByUserId: dto.originType === 'SYSTEM' ? null : userId,
      },
    });
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

    if ((thread.tests as any[]).length === 0) {
      throw new NotFoundException('No versions found for this thread');
    }

    return (thread.tests as any[])[0]; // Already ordered desc
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

    const ruleSnapshot = test.ruleSnapshot as any;
    const sectionSnapshot = test.sectionSnapshot as any[];
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
