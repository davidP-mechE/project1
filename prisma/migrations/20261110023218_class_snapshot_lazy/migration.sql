-- AlterEnum
ALTER TYPE "UsageFeature" ADD VALUE 'WORKSHEET';

-- AlterTable
ALTER TABLE "ClassCourse" ALTER COLUMN "fileKey" DROP NOT NULL,
ALTER COLUMN "figuresPrefix" DROP NOT NULL,
ALTER COLUMN "snapshotOf" DROP NOT NULL;
