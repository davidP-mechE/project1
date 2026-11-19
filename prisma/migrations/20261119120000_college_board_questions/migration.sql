-- Official College Board questions added from the College Board upload page.
ALTER TYPE "QuestionSource" ADD VALUE 'college_board';

-- Usage of reading those uploads with Claude.
ALTER TYPE "UsageFeature" ADD VALUE 'QUESTION_IMPORT';
