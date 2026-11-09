-- CreateEnum
CREATE TYPE "QuestionScope" AS ENUM ('LESSON', 'UNIT_TEST', 'FINAL_EXAM');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'SHORT_ANSWER', 'STEP_BY_STEP');

-- CreateEnum
CREATE TYPE "UsageFeature" AS ENUM ('LESSON', 'QUESTIONS', 'PAGE_REPAIR', 'GRADING', 'TUTOR');

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "cacheKey" TEXT,
ADD COLUMN     "content" JSONB,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "userEdited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,
    "scope" "QuestionScope" NOT NULL DEFAULT 'LESSON',
    "type" "QuestionType" NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "choices" TEXT[],
    "correctChoice" INTEGER,
    "answer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "steps" TEXT[],
    "pageRefs" INTEGER[],
    "topic" TEXT NOT NULL,
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flashcard" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "pageRefs" INTEGER[],
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flashcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "lessonId" TEXT,
    "feature" "UsageFeature" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_lessonId_order_idx" ON "Question"("lessonId", "order");

-- CreateIndex
CREATE INDEX "Question_courseId_idx" ON "Question"("courseId");

-- CreateIndex
CREATE INDEX "Flashcard_lessonId_order_idx" ON "Flashcard"("lessonId", "order");

-- CreateIndex
CREATE INDEX "Flashcard_courseId_idx" ON "Flashcard"("courseId");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_courseId_idx" ON "UsageEvent"("courseId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
