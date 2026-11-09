# Textbook → Course: Implementation Plan

Status: **approved; Phases 1–9 built** (see README for what's done and how it works).

Working name: **Coursebook** (rename any time; it only appears in the UI title and README).

---

## 0. Key decisions (and why, in plain language)

| # | Decision | Why |
|---|----------|-----|
| D1 | **Next.js (App Router) + TypeScript + Tailwind**, as you proposed | One language front to back; App Router lets server code (database reads, secrets) stay on the server automatically. |
| D2 | **PostgreSQL everywhere, including local dev** (via Docker Compose), with **pgvector** | SQLite can't do pgvector, and running two different databases causes "works on my machine" bugs. Docker makes local Postgres a one-command thing. |
| D3 | **Prisma** ORM | Typed queries and easy migrations. Vector columns aren't natively supported by Prisma, so the few vector queries use raw SQL. |
| D4 | **A separate worker process** (BullMQ + Redis), not Inngest | Processing a 1,000-page book (OCR, image rendering) takes many minutes and lots of CPU. Vercel functions are killed after a time limit, so heavy work must run on a normal long-running server. The worker is the same codebase with a second entry point (`npm run worker`). In production: web app on Vercel, worker on Railway/Fly/Render (~$5–10/month). |
| D5 | **Suggested change: Better Auth instead of Auth.js** | Auth.js deliberately discourages email+password ("Credentials") login and doesn't support database sessions with it; you'd hand-build verification, reset, etc. Better Auth has email+password, email verification, password reset, Google sign-in, and database-backed sessions built in, and works with Prisma. If you'd rather stick with Auth.js, I'll do that — it just means more custom code. |
| D6 | **Uploads go straight from the browser to object storage** using a pre-signed URL | Vercel rejects request bodies over ~4.5 MB, so a 200 MB PDF can't pass through the app server. The browser uploads directly to R2/S3 and we show a real progress bar. In dev, a local "fake S3" route writes to `./storage/`. One `Storage` interface, two implementations (local disk, S3-compatible — R2 is S3-compatible). |
| D7 | **Extraction with pdf.js (`pdfjs-dist`) in the worker; OCR with `tesseract.js`** | Both run in Node with no system installs, so Docker and dev stay simple. Pages are rendered to images with `@napi-rs/canvas` for OCR and figure capture. |
| D8 | **Math: detect, then repair only the pages that need it** | PDFs store equations as positioned symbols, so plain text extraction mangles them (e.g. `x2 + y2` instead of `x² + y²`). We score each page for "math density"; for pages above a threshold we send *that page's image* to Claude (vision) to transcribe equations into LaTeX. This costs money, so it's capped and shown in the cost estimate. Everything renders with KaTeX. Honest limit: it won't be perfect, so heavily-garbled sections are flagged rather than guessed. |
| D9 | **Claude models (current as of Nov 2026), configurable via env vars** | Bulk lesson generation: **`claude-sonnet-5-5`** ($2 / $10 per million input/output tokens) — good quality at a fifth of Opus cost. Grading short answers + tutor chat: **`claude-opus-5-5`** ($4 / $20) — needs the best judgment about "is this answer right according to the book". Cheap helper tasks (heading cleanup, front-matter classification): **`claude-haiku-5-5`** ($0.10 / $0.50). Uses structured JSON output so responses always match our schema, and prompt caching so the shared instructions are billed at a discount. |
| D10 | **Embeddings for "Ask the book": provider interface, default = local model** (`bge-small-en-v1.5` via `@huggingface/transformers`, runs on CPU, free, data never leaves your server). Optional Voyage AI (Anthropic's recommended embeddings partner) for production. | Anthropic doesn't offer an embeddings API. A local model means no second API key to start. |
| D11 | **Search: Postgres full-text search** (for the search page) + **pgvector** (for the tutor), combined as "hybrid" retrieval for the tutor | Full-text is great for exact words ("Kirchhoff"); vectors are great for meaning ("why does current split at a junction"). Using both gives better tutor answers. |
| D12 | **Spaced repetition: FSRS via the `ts-fsrs` library**, wrapped in our own small module that we unit-test | FSRS is the modern successor to SM-2 (Anki switched to it); it schedules reviews more accurately so you review less for the same retention. |
| D13 | **PDF study-guide export rendered by headless Chromium (Playwright) in the worker** | We already render lessons as HTML with KaTeX; printing that HTML to PDF guarantees the export looks exactly like the app, math included. |
| D14 | **Email: Resend in production, Mailpit in dev** | Mailpit is a fake inbox in Docker at `localhost:8025` — you can test verification/reset emails without sending real ones. |
| D15 | **Analytics: our own small `AnalyticsEvent` table**, Sentry for errors | No third-party trackers on student data; the admin page shows feature usage counts. |
| D16 | **Tests: Vitest** for core logic, a few **Playwright** end-to-end tests for critical flows (sign up → upload → study) | Fast unit tests for the tricky logic you listed; e2e only for the paths that must never break. |
| D17 | **Single package, not a monorepo** | Web and worker share `src/lib/**`. Simpler to understand than multiple workspace packages. |

---

## 1. Folder structure

```
/
├─ PLAN.md, README.md, docker-compose.yml, Dockerfile(.worker), .env.example
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/              (incl. raw SQL for pgvector + full-text indexes)
├─ src/
│  ├─ app/                     Next.js routes (pages + route handlers)
│  │  ├─ (marketing)/          landing, terms, privacy, copyright
│  │  ├─ (auth)/               login, signup, verify, forgot/reset password
│  │  ├─ (app)/                logged-in area: library, dashboard, courses, review, plan, settings
│  │  ├─ admin/
│  │  └─ api/                  route handlers (uploads, files, streaming, cron, auth)
│  ├─ components/              UI (ui/ primitives, course/, study/, pdf/, editor/)
│  ├─ server/                  server-only code (never shipped to the browser)
│  │  ├─ auth.ts, db.ts, storage/, queue.ts, email/, ratelimit.ts, usage/, authz.ts
│  │  ├─ actions/              Server Actions (mutations) grouped by feature
│  │  └─ ai/                   Claude client, prompts/, schemas/, cost.ts
│  ├─ lib/                     pure, framework-free logic (heavily unit-tested)
│  │  ├─ pdf/                  extract.ts, ocr-detect.ts, math-score.ts, figures.ts
│  │  ├─ outline/              from-bookmarks.ts, heading-detect.ts, front-back-matter.ts, page-ranges.ts
│  │  ├─ chunking/             chunk.ts (page-aware, token-bounded)
│  │  ├─ srs/                  fsrs.ts (wrapper + queue builder)
│  │  ├─ planning/             study-plan.ts, streaks.ts
│  │  ├─ usage/                limits.ts, pricing.ts, estimate.ts
│  │  ├─ grading/              mcq.ts, normalize.ts
│  │  └─ export/               anki.ts, csv.ts, markdown.ts
│  └─ worker/
│     ├─ index.ts              starts BullMQ workers
│     └─ jobs/                 process-book.ts, generate-lesson.ts, generate-unit.ts, generate-course.ts, export.ts, reminders.ts
├─ tests/
│  ├─ unit/                    mirrors src/lib
│  ├─ fixtures/                small generated PDFs (with/without outline, scanned, math-heavy)
│  └─ e2e/
└─ storage/                    local dev file storage (git-ignored)
```

---

## 2. Database schema (Prisma, summarized)

Every user-owned row carries `userId` (directly or via its course), and **every query is scoped by the logged-in user** through one helper (`authz.ts`) — that's how books stay private.

**Auth (managed by Better Auth):** `User` (+ `role: USER|ADMIN`, `plan: FREE|PRO`, `timezone`, `dailyGoalMinutes`, `reminderEmails`), `Session`, `Account` (Google), `Verification`.

**Books & extraction**
- `Book` — id, userId, title, originalFilename, storageKey, sizeBytes, sha256, pageCount, coverKey, hasBuiltInOutline, status (`UPLOADED|PROCESSING|READY|FAILED`), error.
- `Page` — bookId, pageNumber (physical, 1-based), pageLabel (printed number like "xii" or "47"), text, textSource (`NATIVE|OCR|VISION`), charCount, ocrConfidence, mathScore, isFrontBackMatter. Unique (bookId, pageNumber).
- `Figure` — bookId, pageNumber, storageKey, width, height, caption.
- `Chunk` — bookId, pageStart, pageEnd, text, tokenCount, `embedding vector(384)`, `tsv tsvector` (raw SQL columns + indexes).

**Courses**
- `Course` — id, userId, bookId, title, status (`OUTLINE_DRAFT|GENERATING|ACTIVE|ARCHIVED`), settings JSON (level, style, contentTypes[], includeFrontBackMatter), lastOpenedAt, courseMap JSON.
- `Unit` — courseId, order, title, summary JSON, status.
- `Lesson` — unitId, courseId, order, title, pageStart, pageEnd, status (`PENDING|QUEUED|GENERATING|READY|FLAGGED|FAILED`), flagReason, content JSON (objectives, explanation markdown, workedExamples, keyTerms), **cacheKey** (hash of source text + settings + prompt version + model), model, userEdited, generatedAt.
- `Question` — courseId, lessonId?, unitId?, scope (`LESSON|UNIT_TEST|FINAL_EXAM`), type (`MCQ|SHORT|STEPS`), prompt, choices JSON, answer, explanation, steps JSON, pageRefs int[], topicTag, order, userEdited.
- `Flashcard` — courseId, lessonId, front, back, pageRefs int[], userEdited.

**Study activity**
- `LessonProgress` — userId, lessonId, completedAt, confusing, lastViewedAt.
- `QuestionAttempt` — userId, questionId, response, correct, score (0–1), feedback, createdAt.
- `CardState` — userId, flashcardId, due, stability, difficulty, reps, lapses, state, lastReview. `ReviewLog` — each rating.
- `Highlight` — userId, lessonId, anchor JSON (text-quote selector), color, note.
- `Note` — userId, courseId, lessonId?, body (markdown).
- `TutorThread` / `TutorMessage` — role, content, citations JSON (pages + chunk ids).
- `StudyPlan` — courseId, targetDate, studyDays int[], minutesPerDay. `PlanItem` — date, kind (`LESSON|REVIEW|UNIT_TEST`), lessonId?, done.
- `StudyDay` — userId, date, minutes, cardsReviewed, questionsAnswered, lessonsCompleted (drives streaks and daily goal).

**Operations**
- `Job` — mirror of each queue job for the status page/admin: type, status, progress 0–100, message ("OCR on page 112…"), error, attempts, bookId?, courseId?, timestamps.
- `UsageEvent` — userId, courseId?, feature (`GENERATE|GRADE|TUTOR|VISION_MATH|EMBED`), model, input/output/cache tokens, costMicroUsd, createdAt.
- `AnalyticsEvent` — userId?, name, props JSON, createdAt.

Plan limits (pages/month, tutor messages/day, etc.) live in code (`lib/usage/limits.ts`) keyed by `User.plan`, so adding Stripe later = setting `plan` from a webhook.

---

## 3. Pages

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth |
| `/library` | Course cards: cover, title, progress bar, last opened; rename/archive/delete; upload button |
| `/library/upload` | Upload with progress bar + rights confirmation checkbox + cost/time estimate |
| `/books/[bookId]/processing` | Live status of extraction job, errors with friendly explanations |
| `/courses/[courseId]/outline` | Outline editor (rename/merge/split/reorder/delete/add, page ranges) with PDF page preview |
| `/courses/[courseId]/setup` | Level, style, content types, front/back matter toggle, estimate, "Generate" |
| `/courses/[courseId]` | Course map overview + generation progress ("Lesson 14 of 52") |
| `/courses/[courseId]/lessons/[lessonId]` | Lesson view, sidebar, next/prev, split PDF view, practice questions, highlights |
| `/courses/[courseId]/units/[unitId]` | Unit summary + unit test |
| `/courses/[courseId]/final-exam` | Final exam |
| `/courses/[courseId]/flashcards` | Browse/edit cards; study this course's cards |
| `/courses/[courseId]/tutor` | "Ask the book" chat (also available as a drawer in the lesson view) |
| `/courses/[courseId]/notes` | All highlights + notes; export Markdown |
| `/courses/[courseId]/search` | Search lessons + original text |
| `/courses/[courseId]/export` | PDF guide, Anki, CSV, Markdown |
| `/review` | Daily due-cards queue across all courses |
| `/dashboard` | Progress, scores per unit, weak topics, cards due, streak |
| `/plan` | Study plan generator + calendar of scheduled items |
| `/settings` | Account (email/password/delete), preferences (theme, daily goal, reminders), usage meter |
| `/admin` | Users, courses, failed jobs (retry), API usage, feature analytics (ADMIN only) |
| `/terms`, `/privacy`, `/copyright` | Placeholder legal pages + takedown contact |

---

## 4. API routes (route handlers)

Most mutations are **Server Actions** (Next.js functions called directly from forms; they get CSRF protection via origin checks). Route handlers exist where we need streaming, file bytes, or external callers:

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...all]` | * | Better Auth (login, signup, Google OAuth, verify, reset) |
| `/api/uploads` | POST | Validate size/quota/rate limit, create `Book`, return pre-signed PUT URL |
| `/api/uploads/[bookId]/complete` | POST | Verify file is a real PDF (magic bytes + parse header), enqueue processing |
| `/api/storage/local/[...key]` | PUT/GET | Dev-only stand-in for S3 (disabled in production) |
| `/api/books/[bookId]/file` | GET | Auth-checked redirect to a short-lived signed URL (supports range requests for the PDF viewer) |
| `/api/books/[bookId]/figures/[id]` | GET | Auth-checked figure image |
| `/api/jobs/[jobId]` | GET | Job status (polled every 2 s by status pages) |
| `/api/courses/[courseId]/generation` | GET | Per-lesson generation status |
| `/api/questions/[questionId]/attempt` | POST | Check MCQ locally; grade SHORT/STEPS with Claude |
| `/api/tutor` | POST | Streaming tutor answer with citations |
| `/api/exports/[exportId]` | GET | Download a finished export |
| `/api/cron/reminders` | POST | Called by Vercel Cron (secret-protected); enqueues reminder emails |
| `/api/health` | GET | Liveness for Docker/hosting |

---

## 5. Background jobs (BullMQ queues, run by the worker)

| Queue / job | Steps & notes |
|---|---|
| `book.process` | 1) download & validate → 2) extract text per page (pdf.js) with page labels → 3) find low-text pages (< ~40 chars but has images) → OCR them (tesseract.js) → 4) extract figures (embedded images, rendered crops) → 5) math score per page → vision-to-LaTeX on top pages (capped) → 6) outline from bookmarks, else heading detection (font size/bold/numbering patterns like "2.3") → 7) mark front/back matter (copyright, contents, index, glossary) → 8) chunk (≈500 tokens, page-aware) + embed + full-text index → 9) create `Course` in `OUTLINE_DRAFT`. Each step updates `Job.message/progress`. Steps are resumable: a retry skips completed steps. |
| `lesson.generate` | Input = that lesson's page text only. Check `cacheKey` → skip if unchanged. Quality gate before calling Claude (too little text / too many garbled math pages → `FLAGGED` with reason, no guessing). Structured JSON output; validates page refs fall inside the lesson's page range. Records `UsageEvent`. Per-user concurrency limit (e.g. 3 at a time). Mode `questions-only` regenerates just questions. |
| `unit.generate` | After all lessons in a unit are ready: summary + unit test drawn from lesson content. |
| `course.finalize` | After all units: final exam + course map. |
| `export.build` | PDF (Playwright), Anki `.apkg` (SQLite inside a zip, built with `better-sqlite3`), CSV, Markdown. |
| `reminders.send` | Daily, per-user timezone: email if goal not met and reminders on. |
| `maintenance` | Clean up orphaned uploads, expired exports. |

Generation order: lessons are queued in course order, so you can study lesson 1 while lesson 30 is still generating.

---

## 6. Claude usage design

- **One lesson per request**, input = system prompt (cached) + course settings + the section's page text with `[p. 47]` markers so the model can cite pages.
- **Structured outputs** (a JSON schema matching our Zod types) so lessons always parse.
- **Grounding rules in the prompt**: only use the provided text; if something is missing, say so; cite page markers. Server-side check rejects citations outside the lesson's range.
- **Grading**: question + reference answer + explanation + the cited source pages → `{score, correct, feedback}`. Low effort setting to keep it fast and cheap.
- **Tutor**: hybrid retrieval (top ~8 chunks) → answer with `[p. N]` citations; if retrieval scores are low or the model judges the book doesn't cover it, it says so.
- **Refusals / errors**: handle `stop_reason` and typed SDK errors; retries with backoff in BullMQ; friendly message in UI.
- **Every call goes through one wrapper** (`server/ai/client.ts`) that checks quotas, applies rate limits, and records token usage + cost.

### Cost estimate per 100 pages (rough, to be measured in Phase 4)

Assumptions: ~800 tokens of text per page, ~10 lessons per 100 pages, ~8K output tokens per lesson (content + questions + flashcards + model reasoning), Sonnet 5.5 for generation.

| Item | Tokens | Cost |
|---|---|---|
| Lesson input | ~100K in | ~$0.20 |
| Lesson output | ~80K out | ~$0.80 |
| Unit summaries/tests, final exam, course map | ~40K in / 25K out | ~$0.33 |
| Math-heavy page repair (vision, if ~10% of pages) | ~10 pages | ~$0.15 |
| **Total** | | **≈ $1.50 per 100 pages** (≈ $15 for a 1,000-page book) |

Studying costs extra per use: a graded short answer ≈ $0.01, a tutor message ≈ $0.02–0.05 (Opus 5.5). Swapping generation to Haiku 5.5 would cut generation cost ~20× at some quality loss — it's one env var to try.

---

## 7. Security & privacy baseline (applied from Phase 1, audited in Phase 10)

- Secrets only in server env vars; `server-only` import guard on all server modules.
- Passwords hashed (scrypt/argon2 via Better Auth); httpOnly, Secure, SameSite cookies; database sessions.
- CSRF: Server Actions' origin check + SameSite cookies; route handlers verify `Origin`.
- Upload validation: size limit, `%PDF-` magic bytes, parse check, page-count limit, per-user quota, rate limit.
- All generated/markdown content rendered through a sanitizer (no raw HTML from the model or PDF).
- Authorization helper used on every data access; tests that user A can't read user B's course.
- Account deletion cascades in the DB and deletes stored files.

---

## 8. Build order (your phases, with what "done" means)

1. **Setup, auth, library, upload + storage** — Docker Compose (Postgres+pgvector, Redis, Mailpit), Prisma schema v1, Better Auth (email/password, verification, reset, Google), library page, direct upload with progress bar, local/S3 storage, account settings + delete. *Tests:* storage adapter, PDF validation, authz scoping.
2. **Extraction, OCR, outline, jobs + status page** — worker, `book.process` pipeline, status page. *Tests:* extraction on fixture PDFs, low-text detection, outline from bookmarks, heading detection, front/back matter, chunking.
3. **Outline editor + course settings** — editing operations as pure functions (merge/split/reorder/ranges) + UI + cost estimate. *Tests:* outline operations, page-range validation, estimate math.
4. **Lesson generation** — prompts, schemas, generation jobs, caching, regenerate/questions-only/hand edit, progress UI, flagging. *Tests:* cache key, schema validation, citation range checks, quality gate (Claude mocked). One real-API smoke test you can run with your key.
5. **Study view + split PDF + practice/grading** — sidebar, completion, pdf.js viewer jumping to cited page, KaTeX, MCQ check, Claude grading. *Tests:* MCQ/normalization grading, progress calc.
6. **Flashcards + SRS, highlights/notes, search** — *Tests:* FSRS scheduling & due-queue, full-text query builder.
7. **Tutor** — embeddings, hybrid retrieval, streaming chat with citations, "not in the book" behavior. *Tests:* retrieval ranking/fusion, citation parsing.
8. **Dashboard, weak topics, study plan, streaks, reminders** — *Tests:* plan scheduler, streak/timezone logic, weak-topic scoring.
9. **Unit tests/final exam, exports** — *Tests:* Anki package structure, CSV escaping, Markdown export.
10. **Usage limits, admin, legal, security & accessibility pass, deployment** — *Tests:* limits/quota math, rate limiter; axe accessibility checks in e2e; deploy guide for Vercel + worker host + Neon/Supabase Postgres + R2 + Upstash Redis.

After each phase: run instructions, a manual test checklist, README update, and a commit.

---

## 9. Open questions for you

1. OK to use **Better Auth** instead of Auth.js (D5)?
2. OK with **local embeddings by default** (D10), or would you rather use Voyage AI from the start?
3. Do you have a **Google OAuth client** and an **Anthropic API key** ready? (Not needed until the end of Phase 1 and Phase 4 respectively — everything else works without them.)
4. Any preferred app name?
