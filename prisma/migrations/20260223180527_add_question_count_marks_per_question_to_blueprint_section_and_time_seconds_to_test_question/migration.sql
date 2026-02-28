-- AlterTable
ALTER TABLE "ExamBlueprintSection" ADD COLUMN     "marksPerQuestion" DECIMAL(65,30) NOT NULL DEFAULT 4,
ADD COLUMN     "questionCount" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "TestQuestion" ADD COLUMN     "timeSeconds" INTEGER;
