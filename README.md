# Coursebook

Turn a textbook PDF into a structured, self-paced course: units, lessons, practice questions, flashcards with spaced repetition, and an "Ask the book" tutor that only answers from the textbook.

> **Status:** Phases 1–2 of 10 are complete (accounts, library, upload, and reading the book: text extraction, OCR, figures, outline detection, background worker). See [PLAN.md](PLAN.md) for the full design and build order.

| Phase | What | Status |
|---|---|---|
| 1 | Project setup, auth, library, PDF upload + storage | ✅ Done |
| 2 | Extraction, OCR fallback, outline detection, background jobs | ✅ Done |
| 3 | Outline editor + course settings | ⏳ Next |
| 4 | Lesson generation with Claude | |
| 5 | Study view, split PDF viewer, practice questions + grading | |
| 6 | Flashcards (spaced repetition), highlights/notes, search | |
| 7 | "Ask the book" tutor | |
| 8 | Dashboard, weak topics, study plan, streaks, reminders | |
| 9 | Unit tests / final exam, exports | |
| 10 | Usage limits, admin, legal, security + accessibility pass, deployment | |

---

## Quick start (your computer)

You need **Node.js 22+** and **Docker Desktop**.

```bash
git clone <your repo url> coursebook
cd coursebook
npm install                 # also generates the database client
cp .env.example .env        # then edit .env (see below)
docker compose up -d        # starts Postgres, Redis and Mailpit
npm run db:migrate          # creates the database tables
npm run dev                 # web app: http://localhost:3000
```

In a **second terminal**, start the background worker (it reads uploaded PDFs):

```bash
npm run worker
```

Uploads wait in the queue ("Waiting for a free worker…") until the worker is running.

In `.env`, set at least:

- `BETTER_AUTH_SECRET`: any long random string (`openssl rand -base64 32`).
- `SMTP_HOST=localhost` to send emails to Mailpit, then read them at <http://localhost:8025>. If you leave `SMTP_HOST` empty, emails (verification links, password resets) are printed in the terminal running `npm run dev` instead.

### Without Docker

Install PostgreSQL 16 with the pgvector extension and Redis yourself, create the `coursebook` and `coursebook_test` databases, and point `DATABASE_URL` / `TEST_DATABASE_URL` at them.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the web app in development mode |
| `npm run worker` | Start the background worker (PDF processing) |
| `npm run worker:dev` | Same, restarting automatically when code changes |
| `npm test` | Run the automated tests (uses `TEST_DATABASE_URL`, which gets wiped) |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply/create database migrations (dev) |
| `npm run db:studio` | Browse the database in your browser |
| `npm run fixtures` | Regenerate the test PDFs in `tests/fixtures` (needs Playwright) |

## Environment variables

All configuration lives in `.env` (see [.env.example](.env.example) for comments). Secrets are only read on the server ([src/server/env.ts](src/server/env.ts) validates them at startup and refuses to start if something required is missing).

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | Public URL of the app, used in email links and for CSRF origin checks |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | Separate database for `npm test` (wiped between tests) |
| `REDIS_URL` | yes | Job queue between the web app and the worker |
| `WORKER_CONCURRENCY` | no | Books the worker processes at once (default 1) |
| `OCR_WORKERS` | no | OCR threads per worker (default 2; ~1 CPU core each) |
| `BETTER_AUTH_SECRET` | yes | Signs sessions and local upload links. Keep it secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Enables "Continue with Google". Leave empty to hide the button |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM` | production | Outgoing email. Any SMTP provider works (e.g. Resend's SMTP) |
| `STORAGE_DRIVER` | yes | `local` (files in `./storage`, dev only) or `s3` |
| `LOCAL_STORAGE_DIR` | no | Folder for local storage (default `./storage`) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | if `s3` | AWS S3 or Cloudflare R2 (R2: `S3_REGION=auto`, `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`) |
| `ANTHROPIC_API_KEY` | from Phase 4 | Claude API key |

### Setting up Google sign-in (optional)

1. Go to Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → "Web application".
2. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (and the same path on your production domain).
3. Put the client ID and secret in `.env` and restart `npm run dev`.

## Architecture

```
Browser ──► Next.js app (pages, Server Actions, API routes) ──► PostgreSQL (Prisma)
   │                    │  adds jobs                             ▲
   │                    ▼                                        │ pages, outline, chunks
   │                  Redis (BullMQ queue) ──► Worker (npm run worker): pdf.js + Tesseract OCR
   │                                                │
   └──── uploads/downloads PDFs directly ──► Object storage (local disk / S3 / R2) ◄┘
```

- **`src/app/`**: pages and API routes. Route groups: `(marketing)` public pages, `(auth)` login/sign-up, `(app)` logged-in area.
- **`src/server/`**: server-only code: config (`env.ts`), database (`db.ts`), authentication (`auth.ts`, Better Auth), email, file storage drivers, and the data-access layer (`courses.ts`). Every data-access function takes the logged-in user's id and filters by it, so one student can never see another's books.
- **`src/lib/`**: pure logic with no framework dependencies: PDF checks, text-line grouping, OCR detection, math scoring, outline detection, front/back-matter rules, chunking. This is where most unit tests point.
- **`src/server/processing/`**: the book-processing pipeline (pdf.js wrapper, OCR pool, `process-book.ts`).
- **`src/worker/`**: the background worker process.
- **`prisma/schema.prisma`**: the database schema.
- **`tests/`**: `unit/` (pure logic) and `integration/` (runs against the test database).

### How an upload works

1. The browser asks `POST /api/uploads` for permission (file name, size, rights checkbox). The server checks the rules (PDF, ≤ 200 MB, ≤ 10 uploads/hour), creates the `Book` + `Course` rows, and returns a **signed upload URL**.
2. The browser uploads the file **directly to storage** with a progress bar. Large files never pass through the app server (Vercel would reject anything over ~4.5 MB).
3. The browser calls `POST /api/uploads/:id/complete`. The server checks the stored file's size, its `%PDF-` header, its end-of-file marker, and whether it's encrypted, then marks it ready for processing. Bad files are deleted and the student sees a clear message.

### How a book is processed (Phase 2)

After an upload is verified, a job goes into the Redis queue. The worker (`src/server/processing/process-book.ts`) then:

1. **Opens** the PDF with pdf.js and rejects password-protected, damaged, or over-1,000-page files with a clear message.
2. **Reads text page by page**, keeping each line's font size and the page's printed label (e.g. "xii"). Lines are re-joined into paragraphs and words split by hyphens at line ends are repaired.
3. **OCRs** pages that have (almost) no text but contain an image, i.e. scanned pages, or whose text is mostly broken symbols. Tesseract runs locally at 300 dpi; nothing is sent to an outside service.
4. **Saves figures**: embedded images of at least 120×120 px, stored as PNGs linked to their page.
5. **Scores math**: each page gets a 0–1 "equation-heavy" score. Pages over 0.12 are listed on the course page and will get special handling when lessons are generated (Phase 4).
6. **Makes a cover** from page 1.
7. **Builds the outline**: uses the PDF's bookmarks if it has them (unwrapping "Part I/II" groupings); otherwise detects headings from font sizes (body text is the most common size; the biggest repeated heading size = chapters, the next = sections; running headers and page numbers are ignored); otherwise falls back to 10-page lessons. Chapters become **units**, sections become **lessons**, and chapters longer than 25 pages without sections are split into parts.
8. **Marks front/back matter** (title page, copyright, contents, preface, index, bibliography…) by title and by page text, so they're skipped by default.
9. **Chunks** the remaining text into ~400-token passages with page ranges, for search (Phase 6) and the tutor (Phase 7).

Each step can safely run again. A retry skips pages already read, and the outline and chunks are replaced, so a crash mid-book doesn't start over or duplicate anything. Unexpected errors are retried once automatically; known problems (e.g. password-protected file) fail immediately with a friendly message and a **Try again** button.

**Deployment note:** the worker needs a normal always-on server (Railway, Fly.io, Render…), not Vercel, and must use the same database, Redis and **S3/R2 storage** as the web app. Local-disk storage only works when both run on one machine.

### Key decisions

See the table at the top of [PLAN.md](PLAN.md). Short version: Postgres everywhere (pgvector later), Better Auth for accounts, a separate background worker for heavy PDF processing, direct-to-storage uploads, and Next.js "Cache Components" turned off because almost every page is personal to the logged-in student.

### Security in Phase 1

- Passwords hashed with scrypt; database-backed sessions in httpOnly cookies (`Secure` on HTTPS).
- Email verification required before first login; password reset links expire in 1 hour; resetting a password logs out other sessions.
- CSRF: auth endpoints only accept requests from `APP_URL`; upload routes check the `Origin` header; Server Actions are origin-checked by Next.js.
- Rate limits on login, sign-up and reset emails (production), and on uploads (10/hour).
- Storage keys are generated by the server and validated against path tricks (`../`); local upload links are HMAC-signed and expire.
- Deleting an account deletes every stored file and (by cascade) every database row.

## Estimated Claude API cost per 100 pages

Generation starts in Phase 4; this estimate will be replaced with measured numbers then.

| Item | Approx. tokens | Approx. cost |
|---|---|---|
| Lesson generation input (Claude Sonnet 5.5, $2/M) | ~100K in | $0.20 |
| Lesson generation output ($10/M) | ~80K out | $0.80 |
| Unit summaries/tests, final exam, course map | ~40K in / 25K out | $0.33 |
| Fixing math-heavy pages with vision (~10% of pages) | | $0.15 |
| **Total per 100 pages** | | **≈ $1.50** (≈ $15 for a 1,000-page book) |

While studying: a graded short answer ≈ $0.01, a tutor message ≈ $0.02–0.05 (Claude Opus 5.5).

## Manual test checklist (Phase 2)

Run `npm run dev` **and** `npm run worker`.

1. Upload `tests/fixtures/outlined.pdf`. The course page shows "Reading your textbook…" with a progress bar and step list, then switches to **Detected outline** on its own: 3 units, 5 lessons from bookmarks; Front matter, Contents and Index marked "Skipped by default"; a note that page 7 is equation-heavy.
2. Upload `tests/fixtures/no-outline.pdf`. You get the same outline, this time "by detecting headings".
3. Upload `tests/fixtures/scanned.pdf`. You get a note that 2 scanned pages were read with OCR.
4. Upload a file that starts with `%PDF-` but is otherwise junk (e.g. `printf '%%PDF-1.7\njunk\n%%%%EOF\n' > broken.pdf`). You get "We couldn't read this PDF" and a **Try again** button.
5. The library shows real cover thumbnails for processed books.
6. Stop the worker, upload a book, and it waits at "Waiting for a free worker…". Start the worker again and processing begins.
7. Delete a course while it's processing. The worker stops quietly and nothing is left behind.
8. **Try one of your own textbooks**, ideally one with bookmarks and one without, and check that the outline makes sense. Real PDFs vary a lot, so tell me about anything that looks wrong.

## Manual test checklist (Phase 1)

1. Sign up → you land on "Check your email". Trying to log in before verifying shows "Please verify your email first".
2. Open the verification link (Mailpit inbox or terminal) → you're logged in on an empty library.
3. Upload a real PDF with the rights box ticked → progress bar → course page. "Open original PDF" opens it.
4. Upload a file renamed to `.pdf` that isn't a PDF → friendly error; the library shows it as "Failed".
5. In the library: rename, archive (it moves to the Archived tab), unarchive, delete.
6. Toggle the theme (sun/moon/monitor icon) and resize to phone width.
7. Settings → change password → log out → "Forgot password" → reset via the emailed link → log in.
8. Settings → change email (approve via the email sent to the old address, then verify the new one).
9. Settings → delete account → everything is gone; `/library` redirects to login.
