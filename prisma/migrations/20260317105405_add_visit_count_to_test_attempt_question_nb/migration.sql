-- AlterTable
ALTER TABLE "TestAttemptQuestion" ADD COLUMN     "lastVisitedAt" TIMESTAMP(3),
ADD COLUMN     "visitCount" INTEGER NOT NULL DEFAULT 0;
