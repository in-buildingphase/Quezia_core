-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBlueprint" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExamBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBlueprintSection" (
    "id" UUID NOT NULL,
    "blueprintId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "ExamBlueprintSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamRule" (
    "id" UUID NOT NULL,
    "blueprintId" UUID NOT NULL,
    "totalTimeSeconds" INTEGER NOT NULL,
    "negativeMarking" BOOLEAN NOT NULL,
    "partialMarking" BOOLEAN NOT NULL,
    "adaptiveAllowed" BOOLEAN NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,

    CONSTRAINT "ExamRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSectionRule" (
    "id" UUID NOT NULL,
    "blueprintSectionId" UUID NOT NULL,
    "timeLimitSeconds" INTEGER NOT NULL,
    "maxQuestions" INTEGER NOT NULL,
    "markingScheme" JSONB NOT NULL,

    CONSTRAINT "ExamSectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "examYear" INTEGER NOT NULL,
    "examBlueprintId" UUID NOT NULL,
    "examRuleId" UUID NOT NULL,
    "status" "TestStatus" NOT NULL,
    "isRetake" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSection" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "blueprintSectionId" UUID NOT NULL,
    "timeLimitSeconds" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "TestSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "questionId" TEXT NOT NULL,
    "blueprintSectionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAnswer" (
    "testQuestionId" UUID NOT NULL,
    "finalAnswer" JSONB NOT NULL,
    "timeSpentSeconds" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,

    CONSTRAINT "TestAnswer_pkey" PRIMARY KEY ("testQuestionId")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "testId" UUID NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "normalizedScore" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("testId")
);

-- CreateIndex
CREATE INDEX "Subscription_userId_examId_idx" ON "Subscription"("userId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprint_examId_version_key" ON "ExamBlueprint"("examId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprintSection_blueprintId_sequence_key" ON "ExamBlueprintSection"("blueprintId", "sequence");

-- CreateIndex
CREATE INDEX "ExamRule_blueprintId_effectiveFrom_effectiveTo_idx" ON "ExamRule"("blueprintId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "Test_userId_examId_examYear_idx" ON "Test"("userId", "examId", "examYear");

-- CreateIndex
CREATE UNIQUE INDEX "TestSection_testId_sequence_key" ON "TestSection"("testId", "sequence");

-- CreateIndex
CREATE INDEX "TestQuestion_questionId_idx" ON "TestQuestion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_testId_position_key" ON "TestQuestion"("testId", "position");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprint" ADD CONSTRAINT "ExamBlueprint_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprintSection" ADD CONSTRAINT "ExamBlueprintSection_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamRule" ADD CONSTRAINT "ExamRule_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSectionRule" ADD CONSTRAINT "ExamSectionRule_blueprintSectionId_fkey" FOREIGN KEY ("blueprintSectionId") REFERENCES "ExamBlueprintSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_examBlueprintId_fkey" FOREIGN KEY ("examBlueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_examRuleId_fkey" FOREIGN KEY ("examRuleId") REFERENCES "ExamRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSection" ADD CONSTRAINT "TestSection_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSection" ADD CONSTRAINT "TestSection_blueprintSectionId_fkey" FOREIGN KEY ("blueprintSectionId") REFERENCES "ExamBlueprintSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_blueprintSectionId_fkey" FOREIGN KEY ("blueprintSectionId") REFERENCES "ExamBlueprintSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_testQuestionId_fkey" FOREIGN KEY ("testQuestionId") REFERENCES "TestQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
