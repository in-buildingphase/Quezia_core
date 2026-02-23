import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

async function main() {
    console.log('Starting admin user creation...');

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not defined in environment');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    const adminDetails = {
        username: 'admin',
        email: 'admin@quezia.com',
        password: 'Admin123!',
        role: UserRole.ADMIN,
    };

    try {
        console.log(`Hashing password for ${adminDetails.username}...`);
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(adminDetails.password, saltRounds);

        console.log(`Upserting user: ${adminDetails.email}...`);
        const user = await prisma.user.upsert({
            where: { email: adminDetails.email },
            update: {
                username: adminDetails.username,
                passwordHash: passwordHash,
                role: adminDetails.role,
                isActive: true,
                failedLoginAttempts: 0,
                lockedUntil: null,
            },
            create: {
                email: adminDetails.email,
                username: adminDetails.username,
                passwordHash: passwordHash,
                role: adminDetails.role,
                isActive: true,
                failedLoginAttempts: 0,
                lockedUntil: null,
                profile: {
                    create: {},
                },
            },
        });

        console.log('Admin user created/updated successfully:');
        console.log({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        });

    } catch (error) {
        console.error('Error during admin creation:', error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main();
