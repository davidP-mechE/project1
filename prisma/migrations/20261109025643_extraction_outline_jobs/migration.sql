-- CreateEnum
CREATE TYPE "OutlineSource" AS ENUM ('BOOKMARKS', 'HEADINGS', 'PAGE_RANGES');

-- CreateEnum
CREATE TYPE "TextSource" AS ENUM ('NATIVE', 'OCR', 'NONE');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('PENDING', 'QUEUED', 'GENERATING', 'READY', 'FLAGGED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PROCESS_BOOK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "hasBuiltInOutline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "outlineSource" "OutlineSource";

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "label" TEXT,
    "text" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "textSource" "TextSource" NOT NULL DEFAULT 'NATIVE',
    "ocrConfidence" DOUBLE PRECISION,
    "mathScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "isFrontBackMatter" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Figure" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,

    CONSTRAINT "Figure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "pageStart" INTEGER NOT NULL,
    "pageEnd" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "isFrontBackMatter" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "pageStart" INTEGER NOT NULL,
    "pageEnd" INTEGER NOT NULL,
    "isFrontBackMatter" BOOLEAN NOT NULL DEFAULT false,
    "status" "LessonStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "bookId" TEXT,
    "courseId" TEXT,
    "step" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "errorDetail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Page_bookId_pageNumber_key" ON "Page"("bookId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Figure_bookId_pageNumber_index_key" ON "Figure"("bookId", "pageNumber", "index");

-- CreateIndex
CREATE INDEX "Chunk_bookId_pageStart_idx" ON "Chunk"("bookId", "pageStart");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_bookId_ordinal_key" ON "Chunk"("bookId", "ordinal");

-- CreateIndex
CREATE INDEX "Unit_courseId_order_idx" ON "Unit"("courseId", "order");

-- CreateIndex
CREATE INDEX "Lesson_unitId_order_idx" ON "Lesson"("unitId", "order");

-- CreateIndex
CREATE INDEX "Lesson_courseId_idx" ON "Lesson"("courseId");

-- CreateIndex
CREATE INDEX "Job_bookId_createdAt_idx" ON "Job"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Figure" ADD CONSTRAINT "Figure_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
