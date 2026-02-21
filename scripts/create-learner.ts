import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

async function main() {
    console.log('Starting learner user creation...');

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not defined in environment');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    const learnerDetails = {
        username: 'test',
        email: 'test@gmail.com',
        password: 'Test123!',
        role: UserRole.LEARNER,
    };

    try {
        console.log(`Hashing password for ${learnerDetails.username}...`);
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(learnerDetails.password, saltRounds);

        console.log(`Upserting user: ${learnerDetails.email}...`);
        const user = await prisma.user.upsert({
            where: { email: learnerDetails.email },
            update: {
                username: learnerDetails.username,
                passwordHash: passwordHash,
                role: learnerDetails.role,
            },
            create: {
                email: learnerDetails.email,
                username: learnerDetails.username,
                passwordHash: passwordHash,
                role: learnerDetails.role,
                profile: {
                    create: {},
                },
            },
        });

        console.log('Learner user created/updated successfully:');
        console.log({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        });

    } catch (error) {
        console.error('Error during learner creation:', error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main();
