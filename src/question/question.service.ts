import { Injectable } from '@nestjs/common';
import { QuestionRepository } from './question.repository';
import { QuestionValidatorService } from './question-validator.service';
import { QuestionSelectionService } from './question-selection.service';
import { QuestionSelectionRequest } from './dto/selection-request.dto';
import { Question } from '@prisma/client';

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
        this.validator.validateMetadata(data);
        this.validator.validateStructure(data);
        return this.repository.createQuestion(data);
    }
}
