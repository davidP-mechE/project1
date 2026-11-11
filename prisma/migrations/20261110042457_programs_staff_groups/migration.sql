/*
  Warnings:

  - Added the required column `programId` to the `Class` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('TEACHER', 'SPECIALIST', 'VIEWER');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "domains" TEXT[],
ADD COLUMN     "section" TEXT;

-- AlterTable
ALTER TABLE "AssignmentAnswer" ADD COLUMN     "aiScore" DOUBLE PRECISION,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "programId" TEXT;

-- AlterTable
ALTER TABLE "WorksheetItem" ADD COLUMN     "desmosSolvable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "difficulty" TEXT,
ADD COLUMN     "domain" TEXT,
ADD COLUMN     "section" TEXT,
ADD COLUMN     "skill" TEXT,
ADD COLUMN     "tagsConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT 'SAT',
    "targets" INTEGER[] DEFAULT ARRAY[1200, 1300]::INTEGER[],
    "inviteDays" INTEGER NOT NULL DEFAULT 7,
    "aiDailyCapCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassStaff" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "sections" TEXT[],
    "domains" TEXT[],
    "groupIds" TEXT[],
    "canManageStaff" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "sections" TEXT[],
    "domains" TEXT[],
    "groupIds" TEXT[],
    "canManageStaff" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassGroup" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ClassGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateIndex
CREATE INDEX "Program_adminId_idx" ON "Program"("adminId");

-- CreateIndex
CREATE INDEX "ClassStaff_userId_idx" ON "ClassStaff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassStaff_classId_userId_key" ON "ClassStaff"("classId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvite_classId_idx" ON "StaffInvite"("classId");

-- CreateIndex
CREATE INDEX "AuditLog_programId_createdAt_idx" ON "AuditLog"("programId", "createdAt");

-- CreateIndex
CREATE INDEX "ClassGroup_classId_idx" ON "ClassGroup"("classId");

-- CreateIndex
CREATE INDEX "ClassGroupMember_userId_idx" ON "ClassGroupMember"("userId");

-- CreateIndex
CREATE INDEX "Class_programId_idx" ON "Class"("programId");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassStaff" ADD CONSTRAINT "ClassStaff_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassStaff" ADD CONSTRAINT "ClassStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassGroupMember" ADD CONSTRAINT "ClassGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClassGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassGroupMember" ADD CONSTRAINT "ClassGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing classes: one program per teacher (they become its admin), and each teacher is staff on their classes.
INSERT INTO "Program" ("id", "name", "adminId")
SELECT 'prog_' || md5(t."teacherId"), COALESCE(NULLIF(u."name", ''), 'My') || '''s tutoring program', t."teacherId"
FROM (SELECT DISTINCT "teacherId" FROM "Class") t JOIN "user" u ON u."id" = t."teacherId";
UPDATE "Class" SET "programId" = 'prog_' || md5("teacherId");
ALTER TABLE "Class" ALTER COLUMN "programId" SET NOT NULL;
INSERT INTO "ClassStaff" ("id", "classId", "userId", "role", "sections", "domains", "groupIds", "canManageStaff")
SELECT 'cs_' || md5(c."id"), c."id", c."teacherId", 'TEACHER', '{}', '{}', '{}', false FROM "Class" c;
