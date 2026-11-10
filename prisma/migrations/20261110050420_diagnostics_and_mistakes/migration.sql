-- CreateEnum
CREATE TYPE "DiagnosticStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "AssignmentKind" ADD VALUE 'DIAGNOSTIC';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "diagnosticId" TEXT,
ADD COLUMN     "opensAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "testDates" TIMESTAMP(3)[];

-- CreateTable
CREATE TABLE "Diagnostic" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'DRAFT',
    "conversion" JSONB NOT NULL DEFAULT '{"hardMax": 800, "easyMax": 640}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticModule" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "timeLimitSec" INTEGER NOT NULL,
    "itemIds" TEXT[],
    "routeThreshold" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiagnosticModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticAttempt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "path" TEXT[],
    "currentModuleId" TEXT,
    "moduleStartedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "results" JSONB,

    CONSTRAINT "DiagnosticAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemVersion" INTEGER NOT NULL DEFAULT 1,
    "choice" INTEGER,
    "response" TEXT,
    "correct" BOOLEAN NOT NULL,
    "timeMs" INTEGER NOT NULL DEFAULT 0,
    "usedDesmos" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticRetake" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticRetake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MistakeItem" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemId" TEXT,
    "externalUrl" TEXT,
    "externalId" TEXT,
    "section" TEXT,
    "domain" TEXT,
    "skill" TEXT,
    "reason" TEXT,
    "label" TEXT NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MistakeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticModule_diagnosticId_section_stage_key" ON "DiagnosticModule"("diagnosticId", "section", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticAttempt_assignmentId_userId_attemptNo_key" ON "DiagnosticAttempt"("assignmentId", "userId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticAnswer_attemptId_itemId_key" ON "DiagnosticAnswer"("attemptId", "itemId");

-- CreateIndex
CREATE INDEX "DiagnosticRetake_assignmentId_userId_idx" ON "DiagnosticRetake"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "MistakeItem_studentId_retiredAt_due_idx" ON "MistakeItem"("studentId", "retiredAt", "due");

-- CreateIndex
CREATE UNIQUE INDEX "MistakeItem_studentId_sourceType_sourceId_key" ON "MistakeItem"("studentId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "Diagnostic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnostic" ADD CONSTRAINT "Diagnostic_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticModule" ADD CONSTRAINT "DiagnosticModule_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "Diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticAttempt" ADD CONSTRAINT "DiagnosticAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticAttempt" ADD CONSTRAINT "DiagnosticAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticAnswer" ADD CONSTRAINT "DiagnosticAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DiagnosticAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticRetake" ADD CONSTRAINT "DiagnosticRetake_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MistakeItem" ADD CONSTRAINT "MistakeItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
