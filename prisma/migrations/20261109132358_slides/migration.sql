-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('BOOK', 'SLIDES');

-- AlterEnum
ALTER TYPE "OutlineSource" ADD VALUE 'SLIDES';

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "kind" "SourceKind" NOT NULL DEFAULT 'BOOK',
ADD COLUMN     "sourceKey" TEXT;
