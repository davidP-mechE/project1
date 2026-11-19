-- Parent progress emails: switched on per program, weekly or monthly.
ALTER TABLE "Program" ADD COLUMN "guardianFrequency" TEXT NOT NULL DEFAULT 'OFF';
-- Programs that had weekly guardian emails on for any class keep them, weekly.
UPDATE "Program" SET "guardianFrequency" = 'WEEKLY' WHERE "id" IN (SELECT DISTINCT "programId" FROM "Class" WHERE "guardianSummaries" = true AND "programId" IS NOT NULL);

-- Saved replies.
CREATE TABLE "SavedReply" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "programId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SavedReply_ownerId_idx" ON "SavedReply"("ownerId");
CREATE INDEX "SavedReply_programId_idx" ON "SavedReply"("programId");
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Scheduled messages and announcements.
CREATE TABLE "ScheduledSend" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "studentIds" TEXT[],
    "groupIds" TEXT[],
    "title" TEXT,
    "groupId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "reached" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduledSend_status_sendAt_idx" ON "ScheduledSend"("status", "sendAt");
CREATE INDEX "ScheduledSend_authorId_status_idx" ON "ScheduledSend"("authorId", "status");
ALTER TABLE "ScheduledSend" ADD CONSTRAINT "ScheduledSend_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledSend" ADD CONSTRAINT "ScheduledSend_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
