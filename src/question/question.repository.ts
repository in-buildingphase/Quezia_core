import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Difficulty, Question, QuestionType } from '@prisma/client';

@Injectable()
export class QuestionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEligibleQuestions(criteria: {
    subject?: string;
    topic?: string;
    difficulty?: Difficulty;
    questionType?: QuestionType;
    excludeIds?: string[];
  }): Promise<Question[]> {
    // Resolve the latest active version per logical questionId to prevent
    // duplicate content when multiple versions exist with isActive = true.
    const latestVersions = await this.prisma.question.groupBy({
      by: ['questionId'],
      where: {
        isActive: true,
        subject: criteria.subject,
        topic: criteria.topic,
        difficulty: criteria.difficulty,
        questionType: criteria.questionType,
        questionId: criteria.excludeIds?.length
          ? { notIn: criteria.excludeIds }
          : undefined,
      },
      _max: { version: true },
    });

    if (latestVersions.length === 0) return [];

    // Fetch the actual rows for each (questionId, maxVersion) pair
    const results = await Promise.all(
      latestVersions.map((g) =>
        this.prisma.question.findUnique({
          where: {
            questionId_version: {
              questionId: g.questionId,
              version: g._max.version!,
            },
          },
        }),
      ),
    );

    return results.filter((q): q is Question => q !== null);
  }

  async findByQuestionId(
    questionId: string,
    version?: number,
  ): Promise<Question | null> {
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
