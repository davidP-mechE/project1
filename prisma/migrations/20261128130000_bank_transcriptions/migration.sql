-- Question Bank image items transcribed to text: status, both versions, and review reasons.
-- AlterTable
ALTER TABLE "bank_questions" ADD COLUMN     "text_status" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "transcript" JSONB,
ADD COLUMN     "transcript_issues" TEXT[] DEFAULT ARRAY[]::TEXT[];

