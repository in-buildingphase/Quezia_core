import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExamModule } from '../exam/exam.module';
import { AuthModule } from '../auth/auth.module';
import { TestThreadController } from './controllers/test-thread.controller';
import { TestGenerationController } from './controllers/test-generation.controller';
import { TestController } from './controllers/test.controller';
import { AttemptController } from './controllers/attempt.controller';
import { TestService } from './services/test.service';
import { TestGenerationService } from './services/test-generation.service';
import { TestLifecycleService } from './services/test-lifecycle.service';
import { TestQuestionInjectionService } from './services/test-question-injection.service';
import { QuestionModule } from '../question/question.module';
import { ResultModule } from '../result/result.module';

@Module({
    imports: [PrismaModule, ExamModule, AuthModule, QuestionModule, ResultModule],
    controllers: [TestThreadController, TestGenerationController, TestController, AttemptController],
    providers: [
        TestService,
        TestGenerationService,
        TestLifecycleService,
        TestQuestionInjectionService,
    ],
    exports: [TestService, TestGenerationService, TestLifecycleService, TestQuestionInjectionService],
})
export class TestModule { }

