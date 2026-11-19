-- Weekly auto-assigned practice: generated sets are tied to their student.
ALTER TABLE "question_sets" ADD COLUMN "auto_for_student_id" TEXT;

CREATE TABLE "AutoPracticeBatch" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "weekOf" TEXT NOT NULL,
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutoPracticeBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutoPracticeBatch_classId_weekOf_key" ON "AutoPracticeBatch"("classId", "weekOf");
ALTER TABLE "AutoPracticeBatch" ADD CONSTRAINT "AutoPracticeBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutoPracticeItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionIds" TEXT[],
    "skillIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignmentId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutoPracticeItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutoPracticeItem_batchId_studentId_key" ON "AutoPracticeItem"("batchId", "studentId");
CREATE INDEX "AutoPracticeItem_studentId_idx" ON "AutoPracticeItem"("studentId");
ALTER TABLE "AutoPracticeItem" ADD CONSTRAINT "AutoPracticeItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AutoPracticeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutoPracticeItem" ADD CONSTRAINT "AutoPracticeItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Live warm-ups and exit tickets.
CREATE TABLE "LiveRun" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sessionId" TEXT,
    "setId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WARM_UP',
    "code" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "groupIds" TEXT[],
    "revealed" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "LiveRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LiveRun_code_key" ON "LiveRun"("code");
CREATE INDEX "LiveRun_classId_status_idx" ON "LiveRun"("classId", "status");
ALTER TABLE "LiveRun" ADD CONSTRAINT "LiveRun_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveRun" ADD CONSTRAINT "LiveRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveRun" ADD CONSTRAINT "LiveRun_setId_fkey" FOREIGN KEY ("setId") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LiveAnswer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answerGiven" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LiveAnswer_runId_questionId_studentId_key" ON "LiveAnswer"("runId", "questionId", "studentId");
ALTER TABLE "LiveAnswer" ADD CONSTRAINT "LiveAnswer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LiveRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveAnswer" ADD CONSTRAINT "LiveAnswer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
