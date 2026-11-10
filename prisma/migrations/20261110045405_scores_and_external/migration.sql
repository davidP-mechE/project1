-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('DIAGNOSTIC', 'PSAT', 'SAT', 'PRACTICE_BLUEBOOK', 'PRACTICE_OTHER');

-- AlterEnum
ALTER TYPE "AssignmentKind" ADD VALUE 'EXTERNAL';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "externalItems" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ScoreRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "source" "ScoreSource" NOT NULL,
    "takenOn" TIMESTAMP(3) NOT NULL,
    "testName" TEXT,
    "total" INTEGER NOT NULL,
    "rw" INTEGER,
    "math" INTEGER,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "missed" JSONB NOT NULL DEFAULT '[]',
    "enteredById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "userId" TEXT NOT NULL,
    "targetScore" INTEGER,
    "testDate" TIMESTAMP(3),
    "baselinePending" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ExternalResult" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "timeSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScoreRecord_studentId_takenOn_idx" ON "ScoreRecord"("studentId", "takenOn");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalResult_assignmentId_userId_itemKey_key" ON "ExternalResult"("assignmentId", "userId", "itemKey");

-- AddForeignKey
ALTER TABLE "ScoreRecord" ADD CONSTRAINT "ScoreRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalResult" ADD CONSTRAINT "ExternalResult_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalResult" ADD CONSTRAINT "ExternalResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
