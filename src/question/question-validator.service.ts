import { Injectable, BadRequestException } from '@nestjs/common';
import { QuestionType } from '@prisma/client';

@Injectable()
export class QuestionValidatorService {
    validateMetadata(question: any): void {
        if (!question.subject || !question.topic) {
            throw new BadRequestException('Question must have a subject and topic');
        }
    }

    validateStructure(question: any): void {
        if (question.questionType === QuestionType.MCQ) {
            const payload = question.contentPayload as any;
            if (!payload.options || !Array.isArray(payload.options) || payload.options.length < 2) {
                throw new BadRequestException('MCQ question must have at least 2 options');
            }
            // Check if correctAnswer matches an option key (assuming options are objects with {key, text})
            const hasCorrect = payload.options.some((opt: any) => opt.key === question.correctAnswer);
            if (!hasCorrect) {
                throw new BadRequestException('Correct answer must match one of the option keys');
            }
        }

        if (question.questionType === QuestionType.NUMERIC) {
            if (question.numericTolerance === undefined || question.numericTolerance === null) {
                throw new BadRequestException('Numeric question must have a tolerance defined');
            }
            if (isNaN(Number(question.correctAnswer))) {
                throw new BadRequestException('Correct answer for numeric question must be a number');
            }
        }
    }
}
