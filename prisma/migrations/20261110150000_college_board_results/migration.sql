-- AlterTable
ALTER TABLE "ScoreRecord" ADD COLUMN     "domainBands" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "review" JSONB NOT NULL DEFAULT '[]';

