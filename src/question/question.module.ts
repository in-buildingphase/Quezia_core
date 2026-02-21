import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionRepository } from './question.repository';
import { QuestionSelectionService } from './question-selection.service';
import { QuestionValidatorService } from './question-validator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [
        QuestionService,
        QuestionRepository,
        QuestionSelectionService,
        QuestionValidatorService,
    ],
    exports: [QuestionService],
})
export class QuestionModule { }
