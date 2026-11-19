-- Phase 6: files (PNG, JPG, PDF up to 10 MB) attached to messages.
-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('UPLOADING', 'READY');
-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_fileKey_key" ON "MessageAttachment"("fileKey");
-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
-- CreateIndex
CREATE INDEX "MessageAttachment_uploaderId_createdAt_idx" ON "MessageAttachment"("uploaderId", "createdAt");
-- CreateIndex
CREATE INDEX "MessageAttachment_status_createdAt_idx" ON "MessageAttachment"("status", "createdAt");
-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
