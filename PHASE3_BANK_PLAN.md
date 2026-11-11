# Phase 3 (part 2): question bank, answer recorder, analytics, Desmos, tutor view, Course Studio

This plan was written after reading the codebase. It builds on what's there and reuses users,
classes, class staff/scopes, assignments, score records and the existing Desmos button.

## What already exists and gets reused

| Need | Existing piece | How it's reused |
|---|---|---|
| Users, login, 2FA | `User`, Better Auth (`src/server/auth.ts`) | `Role` enum gains `TUTOR` and `OWNER` |
| Tutor ↔ student visibility | `Class`, `ClassMember`, `ClassStaff`, `classAccess()` / `studentInScope()` in `src/server/access.ts` | Every tutor read goes through `classAccess` + `studentInScope` (out of scope = 404) |
| Assignments | `Assignment` (+ progress grid in `src/server/classes.ts`) | New kinds `LOG_TEST`, `QUESTION_SET`; new `calculator` field |
| Score history / charts | `ScoreRecord`, `/scores` | A completed logged test also writes a linked `ScoreRecord`, so existing charts and projections see it |
| SAT domains & skills | `src/lib/sat/domains.ts` | Seed source for the new `skills` table |
| Markdown + LaTeX | `src/components/lesson/markdown.tsx` | Question stems, explanations, lesson text blocks |
| Desmos | `src/components/sat/desmos.tsx` (v1.11 loader) | Replaced by one shared loader + component; old button becomes a thin wrapper |
| File storage | `src/server/storage` | Studio uploads (served only through a checked route) |

## Naming (the spec's tables vs existing names)

`Course`, `Unit`, `Lesson`, `Question` and `QuestionAttempt` already exist (textbook courses).
New tables use the spec's names where free, and a prefix where they'd clash:

| Spec | Prisma model | Table |
|---|---|---|
| skills | `Skill` | `skills` |
| error_types | `ErrorType` | `error_types` |
| practice_tests | `PracticeTest` | `practice_tests` |
| (tutor's private key) | `PracticeTestKey` | `practice_test_keys` |
| test_attempts | `TestAttempt` | `test_attempts` |
| attempt_items | `AttemptItem` | `attempt_items` |
| (tutor comments) | `AttemptComment` | `attempt_comments` |
| questions | `BankQuestion` (+ `BankQuestionVersion`) | `bank_questions`, `bank_question_versions` |
| question_sets | `QuestionSet` | `question_sets` |
| (a sitting of a set) | `PracticeSession` | `practice_sessions` |
| question_attempts | `BankAttempt` | `bank_question_attempts` |
| courses / units / lessons | `StudioCourse`, `StudioUnit`, `StudioLesson`, `StudioBlock`, `StudioFile` | `studio_*` |
| (future sharing) | `StudioCourseShare` (defined, unused) | `studio_course_shares` |

## Decisions (defaults I picked; easy to change)

1. **Roles.** `Role` = `USER` (student), `TUTOR`, `ADMIN` (existing site admin), `OWNER`. The owner is
   whoever has the verified email in `OWNER_EMAIL`: synced at server start (`instrumentation.ts`) and at
   each login; anyone else holding `OWNER` is demoted. `requireOwner()` re-checks role *and* email on every
   request. The owner also passes every existing site-admin check. The owner approves tutors on the Admin page.
2. **"Approved tutor"** = `Role.TUTOR`. Tutors create bank questions, sets and shared practice tests. Seeing
   students still requires being staff on the student's class (existing class staff model).
3. **Custom practice tests.** Owner/tutor tests are shared with everyone; a student's custom test is private to them.
4. **Attempt items.** Only non-correct cells are stored (a cell with no row is correct); skill + error type are
   required for those before the attempt can be marked complete. Drafts save without them.
5. **Versioning.** Same pattern as `WorksheetItemVersion`: the question row holds the current content; editing a
   *published* question snapshots the old content into `bank_question_versions` and bumps `version`.
   Attempts store `question_version`, so they keep pointing at what the student saw.
6. **Seeds.** `npm run db:seed` loads skills, error types, 3 practice tests (names + module sizes only), the two
   draft studio courses, and imports `data/questions/1600-weeks3-6-questions.json` as drafts with the four
   week sets. It's idempotent (re-running skips what exists). Reference data is also created on first start
   if those tables are empty.
7. **Skill names in the 240-question file** that differ slightly from the official skill names
   ("Systems of two linear equations", "Linear inequalities") are matched by an alias table at import. The
   file itself is never edited.
8. **Desmos Toolkit links.** A Studio lesson can be tagged with a Desmos technique; a question's technique links
   to the first *published* lesson with that tag (no link until one exists).
9. **Desmos version** lives in one constant (`v1.11`, what the code used). Desmos's site isn't reachable from
   the build environment, so check their docs for a newer version.
10. **Draft 404s.** `/studio/**`, `/learn/<draft-slug>` and `/api/studio/files/<id>` (draft) all call
    `notFound()` / return 404 for non-owners, with the same body as a missing page.

## Build steps (one commit each)

1. Roles + env vars (`OWNER_EMAIL`, `DESMOS_API_KEY`), full schema + migration, seeds, owner sync. Seed audit test (no College Board content).
2. Question bank: list/filter/search, editor (Markdown/LaTeX preview, choices or grid-in, distractor notes, skill, difficulty, image, status), versioning, CSV/JSON import with preview + template, sets (manual + auto-generate), practice player (timed/untimed, instant feedback, "Likely mistake", grid-in equivalence). Import the 240 questions + 4 week sets.
3. Answer recorder (`/practice-tests`): catalog/custom test, scores, module grids (tap to cycle), tagging panel, autosave, resume.
4. Analytics (`/practice-tests/insights`) and redo list (filters, status, CSV).
5. Desmos: shared loader/component, calculator panel (side panel / bottom sheet, state per set session, hidden when by-hand), check blocks, question Desmos fields, editor "Save graph".
6. Tutor view: class heatmap, student page additions, comments, `LOG_TEST` / `QUESTION_SET` assignments with calculator setting.
7. Course Studio (`/studio`) + student catalog (`/learn`), uploads, preview, publish/unpublish, owner-checked file route.
8. Automated tests (permissions, 404s, import, grading, versioning, analytics hand-count, phone-width e2e) and a summary.
