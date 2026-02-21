import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class GradingService {
    constructor(private readonly prisma: PrismaService) { }

    async calculateAttemptScore(attemptId: string) {
        const attempt = await this.prisma.testAttempt.findUnique({
            where: { id: attemptId },
            include: {
                test: true,
                questions: {
                    include: {
                        testQuestion: true,
                    },
                },
            },
        });

        if (!attempt) return null;

        const ruleSnapshot = attempt.test.ruleSnapshot as any;
        const negativeMarking = ruleSnapshot.negativeMarking ?? false;
        const negativeMarkValue = new Prisma.Decimal(ruleSnapshot.negativeMarkValue || 0);

        let totalScore = new Prisma.Decimal(0);
        let correctCount = 0;
        let attemptedCount = 0;

        for (const aq of attempt.questions) {
            if (!aq.selectedAnswer) continue;

            attemptedCount++;
            const isCorrect = aq.selectedAnswer === aq.testQuestion.correctAnswer;

            // Update question-level results
            let marksAwarded = new Prisma.Decimal(0);
            if (isCorrect) {
                marksAwarded = new Prisma.Decimal(aq.testQuestion.marks as any);
                correctCount++;
            } else if (negativeMarking) {
                marksAwarded = negativeMarkValue.negated();
            }

            await this.prisma.testAttemptQuestion.update({
                where: { id: aq.id },
                data: {
                    isCorrect,
                    marksAwarded,
                },
            });

            totalScore = totalScore.plus(marksAwarded);
        }

        const accuracy = attemptedCount > 0 ? (correctCount / attemptedCount) * 100 : 0;

        return {
            totalScore,
            accuracy: new Prisma.Decimal(accuracy),
            correctCount,
            attemptedCount,
        };
    }
}
