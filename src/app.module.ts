
import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UserModule } from './user/user.module';
import { ExamModule } from './exam/exam.module';
import { TestModule } from './test/test.module';
import { QuestionModule } from './question/question.module';
import { ResultModule } from './result/result.module';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		PrismaModule,
		AuthModule,
		UserModule,
		ExamModule,
		TestModule,
		QuestionModule,
		ResultModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule { }
