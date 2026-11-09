-- CreateEnum
CREATE TYPE "PlanItemKind" AS ENUM ('LESSON', 'REVIEW');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "dailyGoalMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "lastReminderOn" TEXT,
ADD COLUMN     "newCardsPerDay" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "reminderEmails" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminderHour" INTEGER NOT NULL DEFAULT 18;

-- CreateTable
CREATE TABLE "StudyDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "cardsReviewed" INTEGER NOT NULL DEFAULT 0,
    "questionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "lessonsCompleted" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "StudyDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "targetDate" TEXT NOT NULL,
    "studyDays" INTEGER[],
    "minutesPerDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" "PlanItemKind" NOT NULL,
    "lessonId" TEXT,
    "minutes" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyDay_userId_day_key" ON "StudyDay"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPlan_userId_courseId_key" ON "StudyPlan"("userId", "courseId");

-- CreateIndex
CREATE INDEX "PlanItem_planId_day_idx" ON "PlanItem"("planId", "day");

-- AddForeignKey
ALTER TABLE "StudyDay" ADD CONSTRAINT "StudyDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
