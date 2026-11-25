-- Academic Index: inputs, uploads (raw PDFs deleted after review), results, sharing and essay grades.

-- AlterEnum
ALTER TYPE "UsageFeature" ADD VALUE 'ACADEMIC_INDEX_IMPORT';
ALTER TYPE "UsageFeature" ADD VALUE 'ESSAY_GRADING';

-- CreateTable
CREATE TABLE "AcademicIndexInputs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "fieldSources" JSONB NOT NULL DEFAULT '{}',
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "keepEssays" BOOLEAN NOT NULL DEFAULT false,
    "ageCheck" TEXT,
    "ageCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicIndexInputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicIndexUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "storageKey" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "error" TEXT,
    "extracted" JSONB,
    "appliedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AcademicIndexUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicIndexResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "testPoints" DOUBLE PRECISION,
    "gpaPoints" DOUBLE PRECISION NOT NULL,
    "rigorPoints" DOUBLE PRECISION NOT NULL,
    "activityPoints" DOUBLE PRECISION NOT NULL,
    "essayPoints" DOUBLE PRECISION,
    "essayFeedback" JSONB NOT NULL DEFAULT '{}',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "total" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "estimateType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicIndexResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicIndexShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicIndexShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicEssayGrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "essayHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "feedback" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicEssayGrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademicIndexInputs_userId_key" ON "AcademicIndexInputs"("userId");

-- CreateIndex
CREATE INDEX "AcademicIndexUpload_userId_uploadedAt_idx" ON "AcademicIndexUpload"("userId", "uploadedAt");

-- CreateIndex
CREATE INDEX "AcademicIndexUpload_status_uploadedAt_idx" ON "AcademicIndexUpload"("status", "uploadedAt");

-- CreateIndex
CREATE INDEX "AcademicIndexResult_userId_createdAt_idx" ON "AcademicIndexResult"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AcademicIndexShare_classId_idx" ON "AcademicIndexShare"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicIndexShare_userId_classId_key" ON "AcademicIndexShare"("userId", "classId");

-- CreateIndex
CREATE INDEX "AcademicEssayGrade_userId_essayHash_idx" ON "AcademicEssayGrade"("userId", "essayHash");

-- CreateIndex
CREATE INDEX "AcademicEssayGrade_userId_createdAt_idx" ON "AcademicEssayGrade"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AcademicIndexInputs" ADD CONSTRAINT "AcademicIndexInputs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicIndexUpload" ADD CONSTRAINT "AcademicIndexUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicIndexResult" ADD CONSTRAINT "AcademicIndexResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicIndexShare" ADD CONSTRAINT "AcademicIndexShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicIndexShare" ADD CONSTRAINT "AcademicIndexShare_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicEssayGrade" ADD CONSTRAINT "AcademicEssayGrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
