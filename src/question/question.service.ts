import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuestionRepository } from './question.repository';
import { QuestionValidatorService } from './question-validator.service';
import { Question } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionService {
  constructor(
    private readonly repository: QuestionRepository,
    private readonly validator: QuestionValidatorService,
    private readonly prisma: PrismaService,
  ) {}

  async getCanonicalQuestion(
    questionId: string,
    version?: number,
  ): Promise<Question | null> {
    return this.repository.findByQuestionId(questionId, version);
  }

  async deleteCanonicalQuestion(
    questionId: string,
  ): Promise<{ message: string }> {
    const question = await this.repository.findByQuestionId(questionId);
    if (!question)
      throw new NotFoundException(`Question '${questionId}' not found`);

    // Guard: refuse deletion if this question is snapshotted in any test
    const snapshotCount = await this.prisma.testQuestion.count({
      where: { questionId },
    });
    if (snapshotCount > 0) {
      throw new BadRequestException(
        `Cannot delete question '${questionId}': it is referenced in ${snapshotCount} test snapshot(s). Archive those tests first.`,
      );
    }
    await this.prisma.question.deleteMany({ where: { questionId } });
    return { message: `Question '${questionId}' deleted successfully` };
  }

  async createCanonicalQuestion(data: any): Promise<Question> {
    // Full structural + content + metadata validation before persisting
    this.validator.validateFull(data);

    // Set default for optional fields
    const questionData = {
      ...data,
      defaultTimeSeconds: data.defaultTimeSeconds || 60, // Default 60 seconds
    };

    try {
      return await this.repository.createQuestion(questionData);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Question with questionId "${data.questionId}" and version ${data.version} already exists`,
        );
      }
      throw err;
    }
  }
}
