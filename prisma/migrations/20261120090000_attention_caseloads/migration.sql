-- Needs attention: days with no login and no practice before a student is listed as inactive.
ALTER TABLE "Program" ADD COLUMN "inactiveDays" INTEGER NOT NULL DEFAULT 7;

-- Needs attention items marked handled or snoozed.
CREATE TABLE "AttentionState" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttentionState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttentionState_programId_studentId_reason_key" ON "AttentionState"("programId", "studentId", "reason");
ALTER TABLE "AttentionState" ADD CONSTRAINT "AttentionState_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttentionState" ADD CONSTRAINT "AttentionState_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Caseloads: each student's primary tutor in a program.
CREATE TABLE "PrimaryTutor" (
    "programId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrimaryTutor_pkey" PRIMARY KEY ("programId", "studentId")
);
CREATE INDEX "PrimaryTutor_tutorId_idx" ON "PrimaryTutor"("tutorId");
ALTER TABLE "PrimaryTutor" ADD CONSTRAINT "PrimaryTutor_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryTutor" ADD CONSTRAINT "PrimaryTutor_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryTutor" ADD CONSTRAINT "PrimaryTutor_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
