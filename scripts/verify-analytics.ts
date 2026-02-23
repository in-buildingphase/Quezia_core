import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TestLifecycleService } from '../src/test/services/test-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function bootstrap() {
    console.log('🚀 Bootstrapping NestJS App for Analytics Verification...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const lifecycleService = app.get(TestLifecycleService);
    const prisma = app.get(PrismaService);

    try {
        // 1. Setup: Find a user and a published test
        const user = await prisma.user.findFirst({ where: { role: 'LEARNER' } });
        if (!user) throw new Error('No learner user found');

        const test = await prisma.test.findFirst({
            where: {
                status: 'PUBLISHED',
                questions: { some: {} }
            },
            include: { questions: true }
        });
        if (!test) throw new Error('No published test found');

        const examId = test.examId;
        console.log(`Using User: ${user.username}, Test: ${test.id}, Exam: ${examId}`);

        // 2. Start Attempt
        console.log('--- Starting Attempt ---');
        const attempt = await lifecycleService.startAttempt(test.id, user.id);
        console.log(`Created Attempt: ${attempt.id}`);

        // 3. Submit Answers
        console.log('--- Submitting Answers ---');
        for (const tq of test.questions) {
            await lifecycleService.submitAnswer(attempt.id, tq.questionId, tq.correctAnswer, user.id);
        }
        console.log('Submitted all correct answers.');

        // 4. Complete Attempt (Triggers Transactional Analytics)
        console.log('--- Completing Attempt ---');
        await lifecycleService.completeAttempt(attempt.id, user.id);
        console.log('Attempt completed successfully.');

        // 5. Verification
        console.log('--- Verifying Analytics Tables ---');

        const examAnalytics = await prisma.userExamAnalytics.findUnique({
            where: { userId_examId: { userId: user.id, examId } }
        });
        console.log('UserExamAnalytics:', examAnalytics ? '✅ FOUND' : '❌ MISSING');
        if (examAnalytics) console.log(`  Accuracy: ${examAnalytics.overallAccuracy}%, Attempts: ${examAnalytics.totalAttempts}`);

        const subjectAnalytics = await prisma.userSubjectAnalytics.findMany({
            where: { userId: user.id, examId }
        });
        console.log('UserSubjectAnalytics:', subjectAnalytics.length > 0 ? `✅ FOUND (${subjectAnalytics.length})` : '❌ MISSING');

        const topicAnalytics = await prisma.userTopicAnalytics.findMany({
            where: { userId: user.id, examId }
        });
        console.log('UserTopicAnalytics:', topicAnalytics.length > 0 ? `✅ FOUND (${topicAnalytics.length})` : '❌ MISSING');
        if (topicAnalytics.length > 0) {
            console.log(`  Health Status: ${topicAnalytics[0].healthStatus}`);
        }

        const trend = await prisma.performanceTrend.findUnique({
            where: { attemptId: attempt.id }
        });
        console.log('PerformanceTrend:', trend ? '✅ FOUND' : '❌ MISSING');

        const benchmark = await prisma.peerBenchmark.findFirst({
            where: { examId }
        });
        console.log('PeerBenchmark:', benchmark ? '✅ FOUND' : '❌ MISSING');
        if (benchmark) console.log(`  Total Participants: ${benchmark.totalParticipants}`);

        console.log('\n✨ Analytics Verification Complete!');

    } catch (error) {
        console.error('❌ Verification Failed:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
