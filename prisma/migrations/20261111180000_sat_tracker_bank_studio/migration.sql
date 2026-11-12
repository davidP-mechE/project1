-- CreateEnum
CREATE TYPE "CalculatorSetting" AS ENUM ('ALLOWED', 'BY_HAND');

-- CreateEnum
CREATE TYPE "SatSection" AS ENUM ('math', 'rw');

-- CreateEnum
CREATE TYPE "PracticeTestSource" AS ENUM ('bluebook', 'paper', 'other');

-- CreateEnum
CREATE TYPE "TestAttemptStatus" AS ENUM ('draft', 'complete');

-- CreateEnum
CREATE TYPE "ItemResult" AS ENUM ('correct', 'wrong', 'skipped', 'guessed');

-- CreateEnum
CREATE TYPE "RedoStatus" AS ENUM ('to_redo', 'redone_correct', 'still_wrong');

-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('original');

-- CreateEnum
CREATE TYPE "BankQuestionType" AS ENUM ('mcq', 'grid-in');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "DesmosTechnique" AS ENUM ('intersection', 'overlap', 'shading', 'sliders', 'regression', 'list-plug-in', 'table');

-- CreateEnum
CREATE TYPE "SetVisibility" AS ENUM ('private', 'class', 'public');

-- CreateEnum
CREATE TYPE "StudioSection" AS ENUM ('math', 'ebrw', 'other');

-- CreateEnum
CREATE TYPE "StudioStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "StudioVisibility" AS ENUM ('owner_only', 'public');

-- CreateEnum
CREATE TYPE "StudioBlockKind" AS ENUM ('markdown', 'file', 'desmos', 'question_set');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignmentKind" ADD VALUE 'LOG_TEST';
ALTER TYPE "AssignmentKind" ADD VALUE 'QUESTION_SET';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'TUTOR';
ALTER TYPE "Role" ADD VALUE 'OWNER';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "calculator" "CalculatorSetting" NOT NULL DEFAULT 'ALLOWED',
ADD COLUMN     "practiceTestId" TEXT,
ADD COLUMN     "questionSetId" TEXT;

-- AlterTable
ALTER TABLE "ScoreRecord" ADD COLUMN     "testAttemptId" TEXT;

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "section" "SatSection" NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_types" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "error_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_tests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "PracticeTestSource" NOT NULL DEFAULT 'other',
    "modules" JSONB NOT NULL,
    "created_by_id" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_test_keys" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_test_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "date_taken" TIMESTAMP(3) NOT NULL,
    "score_rw" INTEGER,
    "score_math" INTEGER,
    "total" INTEGER,
    "minutes_used" INTEGER,
    "notes" TEXT,
    "status" "TestAttemptStatus" NOT NULL DEFAULT 'draft',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_items" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "section" "SatSection" NOT NULL,
    "module" INTEGER NOT NULL,
    "question_number" INTEGER NOT NULL,
    "result" "ItemResult" NOT NULL,
    "skill_id" TEXT,
    "error_type_id" TEXT,
    "note" TEXT,
    "redo_status" "RedoStatus" NOT NULL DEFAULT 'to_redo',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_comments" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_questions" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "author_id" TEXT,
    "source" "QuestionSource" NOT NULL DEFAULT 'original',
    "section" "SatSection" NOT NULL,
    "skill_id" TEXT,
    "blueprint" TEXT,
    "lesson" TEXT,
    "week" INTEGER,
    "unit" TEXT,
    "focus" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "type" "BankQuestionType" NOT NULL,
    "stem" TEXT NOT NULL,
    "choices" TEXT[],
    "answer" TEXT NOT NULL,
    "answer_text" TEXT,
    "explanation" TEXT NOT NULL DEFAULT '',
    "distractor_notes" JSONB NOT NULL DEFAULT '{}',
    "desmos_state" JSONB,
    "desmos_technique" "DesmosTechnique",
    "image_url" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_question_versions" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "BankQuestionType" NOT NULL,
    "stem" TEXT NOT NULL,
    "choices" TEXT[],
    "answer" TEXT NOT NULL,
    "answerText" TEXT,
    "explanation" TEXT NOT NULL,
    "distractorNotes" JSONB NOT NULL,
    "desmosState" JSONB,
    "imageUrl" TEXT,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_sets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "author_id" TEXT,
    "question_ids" TEXT[],
    "visibility" "SetVisibility" NOT NULL DEFAULT 'private',
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "skill_ids" TEXT[],
    "time_limit_min" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "timeLimitSec" INTEGER,
    "calculator" "CalculatorSetting" NOT NULL DEFAULT 'ALLOWED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_question_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "question_version" INTEGER NOT NULL,
    "set_id" TEXT,
    "sessionId" TEXT,
    "answer_given" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "time_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_question_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_courses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" "StudioSection" NOT NULL DEFAULT 'other',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "StudioStatus" NOT NULL DEFAULT 'draft',
    "visibility" "StudioVisibility" NOT NULL DEFAULT 'owner_only',
    "owner_id" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_course_shares" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT,
    "classId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_course_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_units" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "studio_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_lessons" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "desmos_technique" "DesmosTechnique",

    CONSTRAINT "studio_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_blocks" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "StudioBlockKind" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "studio_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_files" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skills_section_name_key" ON "skills"("section", "name");

-- CreateIndex
CREATE UNIQUE INDEX "error_types_label_key" ON "error_types"("label");

-- CreateIndex
CREATE UNIQUE INDEX "practice_test_keys_classId_testId_key" ON "practice_test_keys"("classId", "testId");

-- CreateIndex
CREATE INDEX "test_attempts_user_id_date_taken_idx" ON "test_attempts"("user_id", "date_taken");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_items_attempt_id_section_module_question_number_key" ON "attempt_items"("attempt_id", "section", "module", "question_number");

-- CreateIndex
CREATE INDEX "attempt_comments_attemptId_createdAt_idx" ON "attempt_comments"("attemptId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_questions_external_id_key" ON "bank_questions"("external_id");

-- CreateIndex
CREATE INDEX "bank_questions_status_section_skill_id_idx" ON "bank_questions"("status", "section", "skill_id");

-- CreateIndex
CREATE INDEX "bank_questions_week_idx" ON "bank_questions"("week");

-- CreateIndex
CREATE UNIQUE INDEX "bank_question_versions_questionId_version_key" ON "bank_question_versions"("questionId", "version");

-- CreateIndex
CREATE INDEX "practice_sessions_userId_setId_idx" ON "practice_sessions"("userId", "setId");

-- CreateIndex
CREATE INDEX "bank_question_attempts_user_id_created_at_idx" ON "bank_question_attempts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bank_question_attempts_question_id_question_version_idx" ON "bank_question_attempts"("question_id", "question_version");

-- CreateIndex
CREATE UNIQUE INDEX "studio_courses_slug_key" ON "studio_courses"("slug");

-- CreateIndex
CREATE INDEX "studio_units_courseId_order_idx" ON "studio_units"("courseId", "order");

-- CreateIndex
CREATE INDEX "studio_lessons_unitId_order_idx" ON "studio_lessons"("unitId", "order");

-- CreateIndex
CREATE INDEX "studio_blocks_lessonId_order_idx" ON "studio_blocks"("lessonId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreRecord_testAttemptId_key" ON "ScoreRecord"("testAttemptId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_practiceTestId_fkey" FOREIGN KEY ("practiceTestId") REFERENCES "practice_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_questionSetId_fkey" FOREIGN KEY ("questionSetId") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreRecord" ADD CONSTRAINT "ScoreRecord_testAttemptId_fkey" FOREIGN KEY ("testAttemptId") REFERENCES "test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_tests" ADD CONSTRAINT "practice_tests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test_keys" ADD CONSTRAINT "practice_test_keys_testId_fkey" FOREIGN KEY ("testId") REFERENCES "practice_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "practice_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_items" ADD CONSTRAINT "attempt_items_error_type_id_fkey" FOREIGN KEY ("error_type_id") REFERENCES "error_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_comments" ADD CONSTRAINT "attempt_comments_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_comments" ADD CONSTRAINT "attempt_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_questions" ADD CONSTRAINT "bank_questions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_questions" ADD CONSTRAINT "bank_questions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_question_versions" ADD CONSTRAINT "bank_question_versions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "bank_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_setId_fkey" FOREIGN KEY ("setId") REFERENCES "question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_question_attempts" ADD CONSTRAINT "bank_question_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_question_attempts" ADD CONSTRAINT "bank_question_attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "bank_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_question_attempts" ADD CONSTRAINT "bank_question_attempts_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "question_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_question_attempts" ADD CONSTRAINT "bank_question_attempts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_course_shares" ADD CONSTRAINT "studio_course_shares_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "studio_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_units" ADD CONSTRAINT "studio_units_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "studio_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_lessons" ADD CONSTRAINT "studio_lessons_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "studio_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_blocks" ADD CONSTRAINT "studio_blocks_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "studio_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_files" ADD CONSTRAINT "studio_files_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "studio_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

