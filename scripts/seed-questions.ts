import { PrismaClient, UserRole, Difficulty, QuestionType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
    console.log('🌱 Seeding Canonical Questions...');

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not defined in environment');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    const subjects = ['Math', 'Physics', 'Chemistry'];
    const difficulties: Difficulty[] = [Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD];

    try {
        for (const subject of subjects) {
            for (const difficulty of difficulties) {
                console.log(`Creating 40 questions for ${subject} - ${difficulty}...`);

                for (let i = 1; i <= 40; i++) {
                    const questionId = `Q-${subject.substring(0, 3).toUpperCase()}-${difficulty}-${i}`;

                    await prisma.question.upsert({
                        where: {
                            questionId_version: {
                                questionId,
                                version: 1,
                            },
                        },
                        update: {},
                        create: {
                            questionId,
                            version: 1,
                            subject,
                            topic: `${subject} Topic ${i % 5}`,
                            subtopic: `SubtopicX`,
                            difficulty,
                            questionType: QuestionType.MCQ,
                            contentPayload: {
                                text: `What is the value of ${subject} variable ${i}?`,
                                options: [
                                    { key: 'A', text: 'Option A' },
                                    { key: 'B', text: 'Option B' },
                                    { key: 'C', text: 'Option C' },
                                    { key: 'D', text: 'Option D' },
                                ],
                            },
                            correctAnswer: 'A',
                            explanation: 'This is a sample explanation.',
                            marks: 4,
                            defaultTimeSeconds: 120,
                            isActive: true,
                        },
                    });
                }
            }
        }
        console.log('✅ Seeding complete!');
    } catch (error) {
        console.error('❌ Error during seeding:', error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main();
