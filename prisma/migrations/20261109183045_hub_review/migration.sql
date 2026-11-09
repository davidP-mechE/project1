-- AlterEnum
ALTER TYPE "QuestionScope" ADD VALUE 'DRILL';

-- DropIndex
DROP INDEX "Book_storageKey_key";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "catalogEntryId" TEXT,
ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "CatalogEntry" (
    "id" TEXT NOT NULL,
    "sourceCourseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fileKey" TEXT NOT NULL,
    "coverKey" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEntry_sourceCourseId_key" ON "CatalogEntry"("sourceCourseId");

-- CreateIndex
CREATE INDEX "CatalogEntry_published_subject_idx" ON "CatalogEntry"("published", "subject");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_catalogEntryId_fkey" FOREIGN KEY ("catalogEntryId") REFERENCES "CatalogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogEntry" ADD CONSTRAINT "CatalogEntry_sourceCourseId_fkey" FOREIGN KEY ("sourceCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
