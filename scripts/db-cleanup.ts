import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Starting Database Cleanup...');

    try {
        // Order matters due to foreign key constraints if not using CASCADE
        // But since we want to be thorough and clean up "test data", 
        // we truncate transactional tables.

        const tables = [
            'TestAttemptQuestion',
            'TestAttempt',
            'InsightLog',
            'AuthAuditLog',
            'Session',
            'TestQuestion',
            'Test',
            'TestThread',
            'UserSubscription',
            'UserExamAnalytics',
            'UserSubjectAnalytics',
            'UserTopicAnalytics',
            'PerformanceTrend',
        ];

        for (const table of tables) {
            await (prisma as any)[table.charAt(0).toLowerCase() + table.slice(1)].deleteMany({});
            console.log(`  - Cleaned ${table}`);
        }

        // Clean up non-admin users
        const deletedUsers = await prisma.user.deleteMany({
            where: {
                role: { not: 'ADMIN' },
                email: { not: 'admin@quezia.com' }
            }
        });
        console.log(`  - Deleted ${deletedUsers.count} non-admin users`);

        console.log('✅ Database Cleanup Complete.');
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
