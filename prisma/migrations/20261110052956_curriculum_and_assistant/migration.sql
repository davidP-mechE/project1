-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UsageFeature" ADD VALUE 'CURRICULUM';
ALTER TYPE "UsageFeature" ADD VALUE 'DRAFT';
ALTER TYPE "UsageFeature" ADD VALUE 'SUMMARY';
ALTER TYPE "UsageFeature" ADD VALUE 'ASSISTANT';

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "closedDates" TIMESTAMP(3)[],
ADD COLUMN     "termEnd" TIMESTAMP(3),
ADD COLUMN     "termStart" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'UPLOAD';

-- AlterTable
ALTER TABLE "WorksheetItem" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT;

-- CreateTable
CREATE TABLE "Curriculum" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Curriculum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumUnit" (
    "id" TEXT NOT NULL,
    "curriculumId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "domains" TEXT[],
    "skills" TEXT[],
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "linkedCourseIds" TEXT[],
    "linkedWorksheetIds" TEXT[],

    CONSTRAINT "CurriculumUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftLesson" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT,
    "skill" TEXT,
    "content" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantSummary" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "groupId" TEXT,
    "weekOf" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurriculumUnit_curriculumId_order_idx" ON "CurriculumUnit"("curriculumId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantSummary_classId_groupId_weekOf_key" ON "AssistantSummary"("classId", "groupId", "weekOf");

-- AddForeignKey
ALTER TABLE "Curriculum" ADD CONSTRAINT "Curriculum_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumUnit" ADD CONSTRAINT "CurriculumUnit_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftLesson" ADD CONSTRAINT "DraftLesson_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantSummary" ADD CONSTRAINT "AssistantSummary_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
