-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('LESSONS', 'QUESTIONS');

-- CreateEnum
CREATE TYPE "WorksheetStatus" AS ENUM ('UPLOADING', 'READING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "classCourseId" TEXT;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "sourceLessonId" TEXT;

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassMember" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassInvite" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassCourse" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sourceCourseId" TEXT,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "coverKey" TEXT,
    "figuresPrefix" TEXT NOT NULL,
    "snapshotOf" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL DEFAULT 'LESSONS',
    "classCourseId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "lessonIds" TEXT[],
    "worksheetId" TEXT,
    "itemIds" TEXT[],
    "timeLimitMin" INTEGER,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "pageCount" INTEGER,
    "status" "WorksheetStatus" NOT NULL DEFAULT 'UPLOADING',
    "error" TEXT,
    "hasAnswerKey" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Worksheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetItem" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "choices" TEXT[],
    "correctChoice" INTEGER,
    "answer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "steps" TEXT[],
    "pageRefs" INTEGER[],
    "topic" TEXT NOT NULL,
    "answerSource" TEXT NOT NULL DEFAULT 'WORKSHEET',

    CONSTRAINT "WorksheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAnswer" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choice" INTEGER,
    "response" TEXT,
    "correct" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "feedback" TEXT NOT NULL DEFAULT '',
    "gradedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentStart" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "AssignmentStart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Class_joinCode_key" ON "Class"("joinCode");

-- CreateIndex
CREATE INDEX "Class_teacherId_idx" ON "Class"("teacherId");

-- CreateIndex
CREATE INDEX "ClassMember_userId_idx" ON "ClassMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassMember_classId_userId_key" ON "ClassMember"("classId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassInvite_classId_email_key" ON "ClassInvite"("classId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ClassCourse_classId_sourceCourseId_key" ON "ClassCourse"("classId", "sourceCourseId");

-- CreateIndex
CREATE INDEX "Assignment_classId_dueAt_idx" ON "Assignment"("classId", "dueAt");

-- CreateIndex
CREATE INDEX "Worksheet_ownerId_createdAt_idx" ON "Worksheet"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WorksheetItem_worksheetId_order_idx" ON "WorksheetItem"("worksheetId", "order");

-- CreateIndex
CREATE INDEX "AssignmentAnswer_assignmentId_userId_idx" ON "AssignmentAnswer"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "AssignmentAnswer_itemId_idx" ON "AssignmentAnswer"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentStart_assignmentId_userId_key" ON "AssignmentStart"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "Lesson_sourceLessonId_idx" ON "Lesson"("sourceLessonId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_classCourseId_fkey" FOREIGN KEY ("classCourseId") REFERENCES "ClassCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassInvite" ADD CONSTRAINT "ClassInvite_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCourse" ADD CONSTRAINT "ClassCourse_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCourse" ADD CONSTRAINT "ClassCourse_sourceCourseId_fkey" FOREIGN KEY ("sourceCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classCourseId_fkey" FOREIGN KEY ("classCourseId") REFERENCES "ClassCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnswer" ADD CONSTRAINT "AssignmentAnswer_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnswer" ADD CONSTRAINT "AssignmentAnswer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAnswer" ADD CONSTRAINT "AssignmentAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentStart" ADD CONSTRAINT "AssignmentStart_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentStart" ADD CONSTRAINT "AssignmentStart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
