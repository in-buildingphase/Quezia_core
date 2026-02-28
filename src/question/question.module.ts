import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionRepository } from './question.repository';
import { QuestionSelectionService } from './question-selection.service';
import { QuestionValidatorService } from './question-validator.service';
import { QuestionController } from './question.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [QuestionController],
  providers: [
    QuestionService,
    QuestionRepository,
    QuestionSelectionService,
    QuestionValidatorService,
  ],
  exports: [QuestionService, QuestionValidatorService],
})
export class QuestionModule {}
