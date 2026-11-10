-- CreateEnum
CREATE TYPE "GenerationBatchStatus" AS ENUM ('SUBMITTED', 'PROCESSED', 'FAILED');

-- AlterEnum
ALTER TYPE "UsageFeature" ADD VALUE 'FLASHCARDS';

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "batch" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GenerationBatch" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "GenerationBatchStatus" NOT NULL DEFAULT 'SUBMITTED',
    "items" JSONB NOT NULL,
    "processedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationBatch_courseId_status_idx" ON "GenerationBatch"("courseId", "status");

-- AddForeignKey
ALTER TABLE "GenerationBatch" ADD CONSTRAINT "GenerationBatch_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
