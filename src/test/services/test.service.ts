import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateThreadDto } from '../dto/create-thread.dto';
import { TestStatus, UserRole } from '@prisma/client';

@Injectable()
export class TestService {
    constructor(private readonly prisma: PrismaService) { }

    async createThread(dto: CreateThreadDto, userId: string, role: UserRole) {
        return this.prisma.testThread.create({
            data: {
                examId: dto.examId,
                originType: dto.originType,
                title: dto.title,
                baseGenerationConfig: dto.baseGenerationConfig,
                createdByUserId: role === UserRole.ADMIN && dto.originType === 'SYSTEM' ? null : userId,
            },
        });
    }

    async getThreadById(threadId: string, userId: string, role: UserRole) {
        const thread = await this.prisma.testThread.findUnique({
            where: { id: threadId },
            include: {
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
            throw new NotFoundException(`Thread with ID ${threadId} not found`);
        }

        // Ownership check
        if (role !== UserRole.ADMIN && thread.createdByUserId && thread.createdByUserId !== userId) {
            throw new ForbiddenException('You do not have access to this thread');
        }

        return thread;
    }

    async getLatestVersion(threadId: string, userId: string, role: UserRole) {
        const thread = await this.getThreadById(threadId, userId, role);

        if (thread.tests.length === 0) {
            throw new NotFoundException('No versions found for this thread');
        }

        return thread.tests[0]; // Already ordered by desc
    }

    async publishTest(testId: string, role: UserRole) {
        if (role !== UserRole.ADMIN) {
            throw new ForbiddenException('Only admins can publish tests');
        }

        const test = await this.prisma.test.findUnique({
            where: { id: testId },
        });

        if (!test) {
            throw new NotFoundException(`Test with ID ${testId} not found`);
        }

        if (test.status !== TestStatus.DRAFT) {
            throw new BadRequestException(`Only DRAFT tests can be published. Current status: ${test.status}`);
        }

        // Integrity check
        const ruleSnapshot = test.ruleSnapshot as any;
        const sectionSnapshot = test.sectionSnapshot as any;

        if (!ruleSnapshot || !sectionSnapshot || Number(test.totalMarks) <= 0 || test.totalQuestions <= 0 || test.durationSeconds <= 0) {
            throw new BadRequestException('Test structure is incomplete or invalid and cannot be published');
        }

        return this.prisma.test.update({
            where: { id: testId },
            data: { status: TestStatus.PUBLISHED },
        });
    }

    async archiveTest(testId: string, role: UserRole) {
        if (role !== UserRole.ADMIN) {
            throw new ForbiddenException('Only admins can archive tests');
        }

        const test = await this.prisma.test.findUnique({
            where: { id: testId },
        });

        if (!test) {
            throw new NotFoundException(`Test with ID ${testId} not found`);
        }

        if (test.status !== TestStatus.PUBLISHED) {
            throw new BadRequestException('Only PUBLISHED tests can be archived');
        }

        return this.prisma.test.update({
            where: { id: testId },
            data: { status: TestStatus.ARCHIVED },
        });
    }

    async getTestById(testId: string, userId: string, role: UserRole) {
        const test = await this.prisma.test.findUnique({
            where: { id: testId },
            include: {
                thread: true,
                questions: true,
            },
        });

        if (!test) {
            throw new NotFoundException(`Test with ID ${testId} not found`);
        }

        // Ownership check for the thread
        if (role !== UserRole.ADMIN && test.thread.createdByUserId && test.thread.createdByUserId !== userId) {
            throw new ForbiddenException('You do not have access to this test');
        }

        return test;
    }
}
