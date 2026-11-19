-- Parent/guardian features removed: guardian contacts, progress emails and their settings.
-- This permanently deletes every stored guardian contact (names, emails, consent records).
ALTER TABLE "GuardianContact" DROP CONSTRAINT "GuardianContact_studentId_fkey";
ALTER TABLE "Class" DROP COLUMN "guardianSummaries";
ALTER TABLE "Program" DROP COLUMN "guardianFrequency";
DROP TABLE "GuardianContact";
