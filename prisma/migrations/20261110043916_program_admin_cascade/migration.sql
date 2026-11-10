-- DropForeignKey
ALTER TABLE "Program" DROP CONSTRAINT "Program_adminId_fkey";

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
