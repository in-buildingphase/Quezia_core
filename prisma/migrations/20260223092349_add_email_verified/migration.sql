/*
  Warnings:

  - A unique constraint covering the columns `[attemptId]` on the table `PerformanceTrend` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[emailVerificationToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[resetPasswordToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_SUCCESS', 'EMAIL_VERIFICATION_REQUEST', 'EMAIL_VERIFICATION_SUCCESS', 'ACCOUNT_SUSPENDED', 'ACCOUNT_ACTIVATED');

-- CreateEnum
CREATE TYPE "AuthEventStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterEnum
ALTER TYPE "Difficulty" ADD VALUE 'MIXED';

-- AlterTable
ALTER TABLE "PeerBenchmark" ADD COLUMN     "lastRecalculatedAt" TIMESTAMP(3),
ADD COLUMN     "totalParticipants" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PerformanceTrend" ADD COLUMN     "attemptId" TEXT;

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "difficulty" "Difficulty";

-- AlterTable
ALTER TABLE "TestAttempt" ADD COLUMN     "userRank" INTEGER;

-- AlterTable
ALTER TABLE "TestQuestion" ADD COLUMN     "negativeMarkValue" DECIMAL(65,30),
ADD COLUMN     "sectionId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "resetPasswordExpires" TIMESTAMP(3),
ADD COLUMN     "resetPasswordToken" TEXT;

-- AlterTable
ALTER TABLE "UserExamAnalytics" ADD COLUMN     "inefficiencyIndex" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "riskClassification" TEXT,
ADD COLUMN     "riskRatio" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "totalAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "event" "AuthEventType" NOT NULL,
    "status" "AuthEventStatus" NOT NULL,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "subtopic" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "contentPayload" JSONB NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT,
    "marks" DECIMAL(65,30) NOT NULL,
    "defaultTimeSeconds" INTEGER NOT NULL,
    "numericTolerance" DECIMAL(65,30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthAuditLog_userId_idx" ON "AuthAuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuthAuditLog_event_idx" ON "AuthAuditLog"("event");

-- CreateIndex
CREATE INDEX "AuthAuditLog_createdAt_idx" ON "AuthAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Question_subject_idx" ON "Question"("subject");

-- CreateIndex
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");

-- CreateIndex
CREATE INDEX "Question_topic_idx" ON "Question"("topic");

-- CreateIndex
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Question_questionId_version_key" ON "Question"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceTrend_attemptId_key" ON "PerformanceTrend"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetPasswordToken_key" ON "User"("resetPasswordToken");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAuditLog" ADD CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
