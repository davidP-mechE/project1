-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "badge" TEXT,
ADD COLUMN     "goalGain" INTEGER,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicBlurb" TEXT,
ADD COLUMN     "schoolAverage" INTEGER,
ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Program_slug_key" ON "Program"("slug");

