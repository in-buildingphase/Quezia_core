import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
    console.log('Starting user cleanup...');

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not defined in environment');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
        const deletedUsers = await prisma.user.deleteMany({
            where: {
                AND: [
                    {
                        email: {
                            not: { contains: 'admin' },
                        },
                    },
                    {
                        username: {
                            not: { contains: 'admin' },
                        },
                    },
                ],
            },
        });

        console.log(`Cleanup complete. Deleted ${deletedUsers.count} users.`);
    } catch (error) {
        console.error('Error during cleanup:', error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main();
