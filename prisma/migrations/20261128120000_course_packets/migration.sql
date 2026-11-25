-- Course packet import: lesson metadata (number, minutes, objectives, skills, blueprints), unit summaries, and stable keys for re-imports.
-- AlterTable
ALTER TABLE "question_sets" ADD COLUMN     "key" TEXT;

-- AlterTable
ALTER TABLE "studio_courses" ADD COLUMN     "estimated_hours" INTEGER,
ADD COLUMN     "program" TEXT;

-- AlterTable
ALTER TABLE "studio_lessons" ADD COLUMN     "blueprints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "estimated_minutes" INTEGER,
ADD COLUMN     "key" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "studio_units" ADD COLUMN     "key" TEXT,
ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "question_sets_key_key" ON "question_sets"("key");

