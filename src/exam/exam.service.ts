import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { CreateBlueprintDto } from './dto/create-blueprint.dto';
import { ActivateBlueprintDto } from './dto/activate-blueprint.dto';

@Injectable()
export class ExamService {
    constructor(private readonly prisma: PrismaService) { }

    async createExam(dto: CreateExamDto) {
        return this.prisma.exam.create({
            data: {
                name: dto.name,
                description: dto.description,
                isActive: dto.isActive ?? true,
            },
        });
    }

    async updateExam(id: string, dto: UpdateExamDto) {
        await this.getExamById(id);
        return this.prisma.exam.update({
            where: { id },
            data: {
                ...(dto.name !== undefined && { name: dto.name }),
                ...(dto.description !== undefined && { description: dto.description }),
                ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            },
        });
    }

    async getAllExams() {
        return this.prisma.exam.findMany({
            include: {
                _count: {
                    select: { blueprints: true },
                },
            },
        });
    }

    async getExamById(id: string) {
        const exam = await this.prisma.exam.findUnique({
            where: { id },
            include: {
                blueprints: {
                    orderBy: { version: 'desc' },
                },
            },
        });

        if (!exam) {
            throw new NotFoundException(`Exam with ID ${id} not found`);
        }

        return exam;
    }

    async createBlueprint(examId: string, dto: CreateBlueprintDto) {
        // Check if exam exists
        await this.getExamById(examId);

        return this.prisma.examBlueprint.create({
            data: {
                examId,
                version: dto.version,
                defaultDurationSeconds: dto.defaultDurationSeconds,
                effectiveFrom: new Date(dto.effectiveFrom),
                effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
                sections: {
                    create: dto.sections.map((s) => ({
                        subject: s.subject,
                        sequence: s.sequence,
                        sectionDurationSeconds: s.sectionDurationSeconds,
                    })),
                },
                rules: {
                    create: dto.rules.map((r) => ({
                        totalTimeSeconds: r.totalTimeSeconds,
                        negativeMarking: r.negativeMarking,
                        negativeMarkValue: r.negativeMarkValue,
                        partialMarking: r.partialMarking,
                        adaptiveAllowed: r.adaptiveAllowed,
                        effectiveFrom: new Date(r.effectiveFrom),
                        effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
                    })),
                },
            },
            include: {
                sections: true,
                rules: true,
            },
        });
    }

    async getBlueprintById(id: string) {
        const blueprint = await this.prisma.examBlueprint.findUnique({
            where: { id },
            include: {
                sections: {
                    orderBy: { sequence: 'asc' },
                },
                rules: true,
            },
        });

        if (!blueprint) {
            throw new NotFoundException(`Blueprint with ID ${id} not found`);
        }

        return blueprint;
    }

    async activateBlueprint(id: string, dto: ActivateBlueprintDto) {
        const blueprint = await this.getBlueprintById(id);

        return this.prisma.examBlueprint.update({
            where: { id },
            data: {
                effectiveFrom: new Date(dto.effectiveFrom),
                effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            },
        });
    }

    /**
     * Archives a blueprint by setting its effectiveTo to the current
     * timestamp, making it no longer active for any future date query.
     */
    async archiveBlueprint(id: string) {
        await this.getBlueprintById(id);
        return this.prisma.examBlueprint.update({
            where: { id },
            data: { effectiveTo: new Date() },
            include: {
                sections: { orderBy: { sequence: 'asc' } },
                rules: true,
            },
        });
    }

    async getActiveBlueprint(examId: string, date: Date = new Date()) {
        return this.prisma.examBlueprint.findFirst({
            where: {
                examId,
                effectiveFrom: { lte: date },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
            },
            orderBy: { version: 'desc' },
            include: {
                sections: { orderBy: { sequence: 'asc' } },
                rules: true,
            },
        });
    }
}
