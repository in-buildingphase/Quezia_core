-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LEARNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestOriginType" AS ENUM ('SYSTEM', 'GENERATED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'NUMERIC');

-- CreateEnum
CREATE TYPE "PreparationStage" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "TopicHealthStatus" AS ENUM ('STABLE', 'IMPROVING', 'VOLATILE', 'WEAK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'LEARNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "targetExamId" TEXT,
    "targetExamYear" INTEGER,
    "preparationStage" "PreparationStage",
    "studyGoal" TEXT,
    "preferredSubjects" JSONB,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER,
    "initialDiagnosticTestId" TEXT,
    "preferredLanguage" TEXT,
    "preferredDifficultyBias" "Difficulty",
    "dailyStudyTimeTargetMinutes" INTEGER,
    "notificationPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SubscriptionPack" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SubscriptionPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentProvider" TEXT,
    "providerReference" TEXT,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBlueprint" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "defaultDurationSeconds" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "ExamBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBlueprintSection" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sectionDurationSeconds" INTEGER,

    CONSTRAINT "ExamBlueprintSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamRule" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "totalTimeSeconds" INTEGER NOT NULL,
    "negativeMarking" BOOLEAN NOT NULL,
    "negativeMarkValue" DECIMAL(65,30),
    "partialMarking" BOOLEAN NOT NULL,
    "adaptiveAllowed" BOOLEAN NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "ExamRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestThread" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "originType" "TestOriginType" NOT NULL,
    "title" TEXT NOT NULL,
    "baseGenerationConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "examId" TEXT NOT NULL,
    "blueprintReferenceId" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "totalMarks" DECIMAL(65,30) NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "sectionSnapshot" JSONB NOT NULL,
    "followsBlueprint" BOOLEAN NOT NULL,
    "status" "TestStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "subtopic" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT,
    "marks" DECIMAL(65,30) NOT NULL,
    "tolerance" DECIMAL(65,30),
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "AttemptStatus" NOT NULL,
    "totalScore" DECIMAL(65,30),
    "accuracy" DECIMAL(65,30),
    "percentile" DECIMAL(65,30),
    "timeSpentSeconds" INTEGER,
    "riskRatio" DECIMAL(65,30),

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttemptQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "testQuestionId" TEXT NOT NULL,
    "selectedAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "marksAwarded" DECIMAL(65,30),
    "timeSpentSeconds" INTEGER,
    "markedForReview" BOOLEAN NOT NULL DEFAULT false,
    "visitationData" JSONB,

    CONSTRAINT "TestAttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserExamAnalytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "overallAccuracy" DECIMAL(65,30) NOT NULL,
    "averageScore" DECIMAL(65,30) NOT NULL,
    "bestRank" INTEGER,
    "currentStreak" INTEGER NOT NULL,
    "averageTimePerQuestion" DECIMAL(65,30) NOT NULL,
    "weakestSubject" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserExamAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubjectAnalytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "accuracy" DECIMAL(65,30) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "averageTime" DECIMAL(65,30) NOT NULL,
    "trendDelta" DECIMAL(65,30) NOT NULL,
    "consistencyScore" DECIMAL(65,30) NOT NULL,
    "lastTestedAt" TIMESTAMP(3),

    CONSTRAINT "UserSubjectAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTopicAnalytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "accuracy" DECIMAL(65,30) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "averageTime" DECIMAL(65,30) NOT NULL,
    "negativeRate" DECIMAL(65,30) NOT NULL,
    "easyAccuracy" DECIMAL(65,30) NOT NULL,
    "mediumAccuracy" DECIMAL(65,30) NOT NULL,
    "hardAccuracy" DECIMAL(65,30) NOT NULL,
    "consistencyScore" DECIMAL(65,30) NOT NULL,
    "trendDelta" DECIMAL(65,30) NOT NULL,
    "lastTestedAt" TIMESTAMP(3),
    "healthStatus" "TopicHealthStatus" NOT NULL,

    CONSTRAINT "UserTopicAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceTrend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "testDate" TIMESTAMP(3) NOT NULL,
    "score" DECIMAL(65,30) NOT NULL,
    "accuracy" DECIMAL(65,30) NOT NULL,
    "percentile" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "PerformanceTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeerBenchmark" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "blueprintVersion" INTEGER,
    "percentileBands" JSONB NOT NULL,
    "subjectAverages" JSONB NOT NULL,
    "scoreDistribution" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeerBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "insightPayload" JSONB NOT NULL,

    CONSTRAINT "InsightLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "UserProfile_targetExamId_idx" ON "UserProfile"("targetExamId");

-- CreateIndex
CREATE INDEX "SubscriptionPack_examId_idx" ON "SubscriptionPack"("examId");

-- CreateIndex
CREATE INDEX "SubscriptionPack_isActive_idx" ON "SubscriptionPack"("isActive");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_idx" ON "UserSubscription"("userId");

-- CreateIndex
CREATE INDEX "UserSubscription_packId_idx" ON "UserSubscription"("packId");

-- CreateIndex
CREATE INDEX "UserSubscription_status_idx" ON "UserSubscription"("status");

-- CreateIndex
CREATE INDEX "UserSubscription_expiresAt_idx" ON "UserSubscription"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_name_key" ON "Exam"("name");

-- CreateIndex
CREATE INDEX "ExamBlueprint_effectiveFrom_idx" ON "ExamBlueprint"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprint_examId_version_key" ON "ExamBlueprint"("examId", "version");

-- CreateIndex
CREATE INDEX "ExamBlueprintSection_blueprintId_idx" ON "ExamBlueprintSection"("blueprintId");

-- CreateIndex
CREATE INDEX "ExamRule_blueprintId_idx" ON "ExamRule"("blueprintId");

-- CreateIndex
CREATE INDEX "TestThread_examId_idx" ON "TestThread"("examId");

-- CreateIndex
CREATE INDEX "TestThread_createdByUserId_idx" ON "TestThread"("createdByUserId");

-- CreateIndex
CREATE INDEX "Test_examId_idx" ON "Test"("examId");

-- CreateIndex
CREATE INDEX "Test_status_idx" ON "Test"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Test_threadId_versionNumber_key" ON "Test"("threadId", "versionNumber");

-- CreateIndex
CREATE INDEX "TestQuestion_testId_idx" ON "TestQuestion"("testId");

-- CreateIndex
CREATE INDEX "TestQuestion_subject_idx" ON "TestQuestion"("subject");

-- CreateIndex
CREATE INDEX "TestQuestion_difficulty_idx" ON "TestQuestion"("difficulty");

-- CreateIndex
CREATE INDEX "TestQuestion_topic_idx" ON "TestQuestion"("topic");

-- CreateIndex
CREATE INDEX "TestAttempt_testId_idx" ON "TestAttempt"("testId");

-- CreateIndex
CREATE INDEX "TestAttempt_userId_idx" ON "TestAttempt"("userId");

-- CreateIndex
CREATE INDEX "TestAttempt_status_idx" ON "TestAttempt"("status");

-- CreateIndex
CREATE INDEX "TestAttempt_completedAt_idx" ON "TestAttempt"("completedAt");

-- CreateIndex
CREATE INDEX "TestAttemptQuestion_attemptId_idx" ON "TestAttemptQuestion"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAttemptQuestion_attemptId_testQuestionId_key" ON "TestAttemptQuestion"("attemptId", "testQuestionId");

-- CreateIndex
CREATE INDEX "UserExamAnalytics_examId_idx" ON "UserExamAnalytics"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "UserExamAnalytics_userId_examId_key" ON "UserExamAnalytics"("userId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSubjectAnalytics_userId_examId_subject_key" ON "UserSubjectAnalytics"("userId", "examId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "UserTopicAnalytics_userId_examId_subject_topic_key" ON "UserTopicAnalytics"("userId", "examId", "subject", "topic");

-- CreateIndex
CREATE INDEX "PerformanceTrend_userId_examId_idx" ON "PerformanceTrend"("userId", "examId");

-- CreateIndex
CREATE INDEX "PerformanceTrend_testDate_idx" ON "PerformanceTrend"("testDate");

-- CreateIndex
CREATE INDEX "PeerBenchmark_examId_idx" ON "PeerBenchmark"("examId");

-- CreateIndex
CREATE INDEX "InsightLog_userId_idx" ON "InsightLog"("userId");

-- CreateIndex
CREATE INDEX "InsightLog_examId_idx" ON "InsightLog"("examId");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_targetExamId_fkey" FOREIGN KEY ("targetExamId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPack" ADD CONSTRAINT "SubscriptionPack_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_packId_fkey" FOREIGN KEY ("packId") REFERENCES "SubscriptionPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprint" ADD CONSTRAINT "ExamBlueprint_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprintSection" ADD CONSTRAINT "ExamBlueprintSection_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamRule" ADD CONSTRAINT "ExamRule_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestThread" ADD CONSTRAINT "TestThread_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestThread" ADD CONSTRAINT "TestThread_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TestThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttemptQuestion" ADD CONSTRAINT "TestAttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttemptQuestion" ADD CONSTRAINT "TestAttemptQuestion_testQuestionId_fkey" FOREIGN KEY ("testQuestionId") REFERENCES "TestQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserExamAnalytics" ADD CONSTRAINT "UserExamAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserExamAnalytics" ADD CONSTRAINT "UserExamAnalytics_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightLog" ADD CONSTRAINT "InsightLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightLog" ADD CONSTRAINT "InsightLog_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
