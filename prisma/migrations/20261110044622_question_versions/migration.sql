-- AlterTable
ALTER TABLE "AssignmentAnswer" ADD COLUMN     "itemVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorksheetItem" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "WorksheetItemVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "choices" TEXT[],
    "correctChoice" INTEGER,
    "answer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "steps" TEXT[],
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorksheetItemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetItemVersion_itemId_version_key" ON "WorksheetItemVersion"("itemId", "version");

-- AddForeignKey
ALTER TABLE "WorksheetItemVersion" ADD CONSTRAINT "WorksheetItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
