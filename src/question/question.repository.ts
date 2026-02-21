import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Difficulty, Question, QuestionType } from '@prisma/client';

@Injectable()
export class QuestionRepository {
    constructor(private readonly prisma: PrismaService) { }

    async findEligibleQuestions(criteria: {
        subject?: string;
        topic?: string;
        difficulty?: Difficulty;
        questionType?: QuestionType;
        excludeIds?: string[];
    }): Promise<Question[]> {
        return this.prisma.question.findMany({
            where: {
                isActive: true,
                subject: criteria.subject,
                topic: criteria.topic,
                difficulty: criteria.difficulty,
                questionType: criteria.questionType,
                questionId: {
                    notIn: criteria.excludeIds,
                },
            },
        });
    }

    async findByQuestionId(questionId: string, version?: number): Promise<Question | null> {
        if (version) {
            return this.prisma.question.findUnique({
                where: {
                    questionId_version: {
                        questionId,
                        version,
                    },
                },
            });
        }
        return this.prisma.question.findFirst({
            where: {
                questionId,
                isActive: true,
            },
            orderBy: {
                version: 'desc',
            },
        });
    }

    async createQuestion(data: any): Promise<Question> {
        return this.prisma.question.create({
            data,
        });
    }
}
