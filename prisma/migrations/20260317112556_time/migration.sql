-- AlterEnum
ALTER TYPE "AttemptStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "TestAttempt" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);
