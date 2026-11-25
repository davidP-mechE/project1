-- Bank questions printed as images (College Board import): image as question, its alt text, rationale image, search-only text.
-- AlterTable
ALTER TABLE "bank_questions" ADD COLUMN     "image_alt" TEXT,
ADD COLUMN     "image_is_question" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rationale_image_url" TEXT,
ADD COLUMN     "search_text" TEXT;

