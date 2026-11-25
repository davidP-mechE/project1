-- Course Studio: video, callout and checkpoint blocks; stable block keys for re-imports; checkpoint self-reports.
-- AlterEnum
ALTER TYPE "StudioBlockKind" ADD VALUE 'video';
ALTER TYPE "StudioBlockKind" ADD VALUE 'callout';
ALTER TYPE "StudioBlockKind" ADD VALUE 'checkpoint';

-- AlterTable
ALTER TABLE "studio_blocks" ADD COLUMN     "key" TEXT;

-- CreateTable
CREATE TABLE "checkpoint_responses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkpoint_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkpoint_responses_userId_blockId_itemId_key" ON "checkpoint_responses"("userId", "blockId", "itemId");

-- AddForeignKey
ALTER TABLE "checkpoint_responses" ADD CONSTRAINT "checkpoint_responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoint_responses" ADD CONSTRAINT "checkpoint_responses_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "studio_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

