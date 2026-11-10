-- AlterTable
ALTER TABLE "user" ADD COLUMN     "calendarToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_calendarToken_key" ON "user"("calendarToken");

