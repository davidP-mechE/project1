-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "detectedOutline" JSONB,
ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "skip" BOOLEAN NOT NULL DEFAULT false;

-- Front/back matter detected in Phase 2 starts out skipped.
UPDATE "Lesson" SET "skip" = "isFrontBackMatter";
