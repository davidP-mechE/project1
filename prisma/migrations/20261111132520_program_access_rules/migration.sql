-- CreateEnum
CREATE TYPE "ProgramAccessMode" AS ENUM ('ONLY', 'BLOCKED');

-- CreateTable
CREATE TABLE "ProgramAccessRule" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "mode" "ProgramAccessMode" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramAccessRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgramAccessRule_email_idx" ON "ProgramAccessRule"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramAccessRule_email_programId_key" ON "ProgramAccessRule"("email", "programId");

-- AddForeignKey
ALTER TABLE "ProgramAccessRule" ADD CONSTRAINT "ProgramAccessRule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
