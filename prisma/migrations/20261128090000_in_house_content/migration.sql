-- In-house content: question/set audience, set source, classes with in-house access, in_house course visibility.

-- CreateEnum
CREATE TYPE "ContentAudience" AS ENUM ('public', 'in_house');

-- AlterEnum
ALTER TYPE "StudioVisibility" ADD VALUE 'in_house';

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "inHouseAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bank_questions" ADD COLUMN     "audience" "ContentAudience" NOT NULL DEFAULT 'public',
ADD COLUMN     "source_detail" TEXT;

-- AlterTable
ALTER TABLE "question_sets" ADD COLUMN     "audience" "ContentAudience" NOT NULL DEFAULT 'public',
ADD COLUMN     "source" "QuestionSource" NOT NULL DEFAULT 'original';

-- Sets that already hold College Board questions are marked, so the ALLOW_COLLEGE_BOARD_CONTENT switch covers them.
UPDATE "question_sets" s SET "source" = 'college_board'
WHERE EXISTS (SELECT 1 FROM "bank_questions" q WHERE q."id" = ANY(s."question_ids") AND q."source" = 'college_board');
