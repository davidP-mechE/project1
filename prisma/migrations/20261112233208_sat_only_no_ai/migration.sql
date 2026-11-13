-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "newStudentsNoAi" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProgramAccessRule" ADD COLUMN     "noAi" BOOLEAN NOT NULL DEFAULT false;
