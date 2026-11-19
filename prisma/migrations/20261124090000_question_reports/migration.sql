-- "Report this question": students flag bank or worksheet questions for authors to review.
CREATE TABLE "QuestionReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "bankQuestionId" TEXT,
    "questionVersion" INTEGER,
    "worksheetItemId" TEXT,
    "assignmentId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "answerGiven" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuestionReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuestionReport_bankQuestionId_status_idx" ON "QuestionReport"("bankQuestionId", "status");
CREATE INDEX "QuestionReport_worksheetItemId_status_idx" ON "QuestionReport"("worksheetItemId", "status");
CREATE INDEX "QuestionReport_reporterId_createdAt_idx" ON "QuestionReport"("reporterId", "createdAt");
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_bankQuestionId_fkey" FOREIGN KEY ("bankQuestionId") REFERENCES "bank_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_worksheetItemId_fkey" FOREIGN KEY ("worksheetItemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
