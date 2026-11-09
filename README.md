# Coursebook

Turn a textbook PDF into a structured, self-paced course: units, lessons, practice questions, flashcards with spaced repetition, and an "Ask the book" tutor that only answers from the textbook.

> **Status:** Phase 1 of 10 is complete (accounts, library, PDF upload and storage). See [PLAN.md](PLAN.md) for the full design and build order.

| Phase | What | Status |
|---|---|---|
| 1 | Project setup, auth, library, PDF upload + storage | ✅ Done |
| 2 | Extraction, OCR fallback, outline detection, background jobs | ⏳ Next |
| 3 | Outline editor + course settings | |
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
npm run dev                 # http://localhost:3000
```

In `.env`, set at least:

- `BETTER_AUTH_SECRET`: any long random string (`openssl rand -base64 32`).
- `SMTP_HOST=localhost` to send emails to Mailpit, then read them at <http://localhost:8025>. If you leave `SMTP_HOST` empty, emails (verification links, password resets) are printed in the terminal running `npm run dev` instead.

### Without Docker

Install PostgreSQL 16 with the pgvector extension and Redis yourself, create the `coursebook` and `coursebook_test` databases, and point `DATABASE_URL` / `TEST_DATABASE_URL` at them.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm test` | Run the automated tests (uses `TEST_DATABASE_URL`, which gets wiped) |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply/create database migrations (dev) |
| `npm run db:studio` | Browse the database in your browser |

## Environment variables

All configuration lives in `.env` (see [.env.example](.env.example) for comments). Secrets are only read on the server ([src/server/env.ts](src/server/env.ts) validates them at startup and refuses to start if something required is missing).

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | Public URL of the app, used in email links and for CSRF origin checks |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | Separate database for `npm test` (wiped between tests) |
| `REDIS_URL` | from Phase 2 | Job queue |
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
   │                    │                                   └► Redis + worker (Phase 2+)
   │                    └─ issues short-lived signed upload/download links
   └──────── uploads/downloads PDFs directly ──────────────► Object storage (local disk / S3 / R2)
```

- **`src/app/`**: pages and API routes. Route groups: `(marketing)` public pages, `(auth)` login/sign-up, `(app)` logged-in area.
- **`src/server/`**: server-only code: config (`env.ts`), database (`db.ts`), authentication (`auth.ts`, Better Auth), email, file storage drivers, and the data-access layer (`courses.ts`). Every data-access function takes the logged-in user's id and filters by it, so one student can never see another's books.
- **`src/lib/`**: pure logic with no framework dependencies (PDF signature checks, upload rules). This is where most unit tests point.
- **`prisma/schema.prisma`**: the database schema.
- **`tests/`**: `unit/` (pure logic) and `integration/` (runs against the test database).

### How an upload works

1. The browser asks `POST /api/uploads` for permission (file name, size, rights checkbox). The server checks the rules (PDF, ≤ 200 MB, ≤ 10 uploads/hour), creates the `Book` + `Course` rows, and returns a **signed upload URL**.
2. The browser uploads the file **directly to storage** with a progress bar. Large files never pass through the app server (Vercel would reject anything over ~4.5 MB).
3. The browser calls `POST /api/uploads/:id/complete`. The server checks the stored file's size, its `%PDF-` header, its end-of-file marker, and whether it's encrypted, then marks it ready for processing. Bad files are deleted and the student sees a clear message.

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
