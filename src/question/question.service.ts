import { ConflictException, Injectable } from '@nestjs/common';
import { QuestionRepository } from './question.repository';
import { QuestionValidatorService } from './question-validator.service';
import { QuestionSelectionService } from './question-selection.service';
import { QuestionSelectionRequest } from './dto/selection-request.dto';
import { Question } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class QuestionService {
    constructor(
        private readonly repository: QuestionRepository,
        private readonly validator: QuestionValidatorService,
        private readonly selectionService: QuestionSelectionService,
    ) { }

    async selectQuestions(request: QuestionSelectionRequest): Promise<Question[]> {
        return this.selectionService.selectQuestions(request);
    }

    async getCanonicalQuestion(questionId: string, version?: number): Promise<Question | null> {
        return this.repository.findByQuestionId(questionId, version);
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
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw new ConflictException(
                    `Question with questionId "${data.questionId}" and version ${data.version} already exists`,
                );
            }
            throw err;
        }
    }
}

