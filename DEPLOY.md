# Deploying Coursebook

This guide puts Coursebook on the internet with managed services. The web app
runs on **Vercel**, and the background worker runs on **Railway** (Fly.io or
Render work the same way). The database is **Neon** Postgres, files go to
**Cloudflare R2**, and email goes through **Resend**. Plan on about an hour the
first time.

```
            ┌──────────────── Vercel ────────────────┐
 Browser ──▶│  Next.js web app (pages, API, auth)    │──┐
    │       └────────────────────────────────────────┘  │
    │  uploads + PDF pages go straight to storage       ├──▶ Neon Postgres (+ pgvector)
    ▼                                                    ├──▶ Redis (job queue, rate limits)
 Cloudflare R2 (private bucket) ◀───────────────────────┤
            ┌──────────── Railway ────────────┐          │
            │  Worker (Dockerfile.worker):    │──────────┘
            │  reads PDFs, OCR, writes lessons│──▶ Claude API (Anthropic)
            │  embeddings, reminder emails    │──▶ Resend (email)
            └─────────────────────────────────┘
```

**Why two parts?** Reading a 1,000-page book takes many minutes and a lot of
memory. Vercel functions are stopped after a time limit, so that work runs on
the worker, a normal long-running server. Both parts use the same code and the
same environment variables.

## What it costs to run

| Service | What for | Rough monthly cost |
|---|---|---|
| Vercel | Web app | Free (Hobby) to $20 (Pro) |
| Railway | Worker (1 GB RAM) + Redis | ~$5–15 |
| Neon | Postgres | Free tier to start; ~$19 when you outgrow it |
| Cloudflare R2 | PDFs and images | Free up to 10 GB, then $0.015/GB; no download fees |
| Resend | Email | Free tier covers a small site |
| Anthropic | Claude API | Pay per use: ≈ $1.50 per 100 textbook pages, plus grading and tutor use (see README) |

Each student's Claude spend is capped by their plan's monthly allowance (see
[Usage limits](#usage-limits)). Also set a spend limit in the Anthropic console
as a second safety net.

---

## 1. Before you start

You need accounts at GitHub (with this repo pushed), Vercel, Railway, Neon,
Cloudflare, Resend and Anthropic. You also need a domain name if you want
email to come from your own address (recommended).

Generate the auth secret once. Both the web app and the worker use it:

```bash
openssl rand -base64 32
```

## 2. Database: Neon

1. Create a project in the region closest to your users, and note the region.
   Put Vercel and Railway in the same one.
2. Under **Connection details**, copy two connection strings:
   - **Pooled** (the host contains `-pooler`): for the **web app**. Vercel opens
     many short connections, and the pooler handles that.
   - **Direct** (no `-pooler`): for the **worker**, which also applies database
     migrations. Migrations need a direct connection.
3. Add `?sslmode=require` to both if it isn't already there.

You don't need to set anything else up. The first migration enables the
`vector` extension (pgvector), which Neon supports.

> **Supabase** works too. Use its "Transaction pooler" URL for the web app and
> the "Direct connection" URL for the worker.

## 3. Redis

The job queue (BullMQ) needs a normal Redis server that keeps every key (no
eviction). The web app uses it as well, to queue jobs and for rate limits, so it
must be reachable from Vercel.

**Recommended: Redis on Railway, next to the worker.**

1. In a new Railway project, choose **+ New → Database → Redis**.
2. Copy its **public** connection URL (`redis://default:…@….proxy.rlwy.net:PORT`)
   for Vercel, and use the private URL (`redis.railway.internal`) for the worker.

> **Upstash** also works, using its `rediss://` TLS URL. BullMQ checks Redis
> constantly, which uses up a pay-per-request plan quickly, so choose a
> fixed-price Upstash plan. Make sure eviction is **off**.

## 4. File storage: Cloudflare R2

1. **R2 → Create bucket**, e.g. `coursebook`. Leave it **private**: never turn
   on public access. Every file is served through short-lived signed links.
2. **R2 → Manage API tokens → Create API token** with **Object Read & Write**,
   limited to this bucket. Note the Access Key ID, the Secret Access Key, and the
   endpoint `https://<account-id>.r2.cloudflarestorage.com`.
3. Go to the bucket's **Settings → CORS policy** and paste the policy below,
   using your real site address. Browsers upload PDFs straight to R2 and the
   viewer reads pages from it, so R2 must allow requests from your site:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type", "range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

The app's Content-Security-Policy allows the R2 endpoint automatically,
based on `S3_ENDPOINT`.

## 5. Email: Resend

1. Add and verify your domain (Resend shows the DNS records to add).
2. Create an API key with sending access.
3. Use these SMTP settings: host `smtp.resend.com`, port `465`, secure `true`,
   user `resend`, and the API key as the password.

## 6. Claude API

1. In console.anthropic.com, create an API key for this app.
2. Under **Limits**, set a monthly spend limit you're comfortable with.
3. Optional: run `npm run smoke:claude` on your computer with this key. It
   costs about $0.03 and checks that the key works with the configured models.

## 7. Environment variables

Set these on **both** Vercel and Railway. Only `DATABASE_URL` and `REDIS_URL`
differ between the two, as explained in steps 2 and 3. The full list, with
comments, is in `.env.example`.

| Variable | Value |
|---|---|
| `APP_URL` | `https://your-domain.com` (no trailing slash) |
| `DATABASE_URL` | Neon **pooled** URL (Vercel) / **direct** URL (Railway) |
| `REDIS_URL` | Railway Redis **public** URL (Vercel) / **private** URL (Railway) |
| `BETTER_AUTH_SECRET` | The random string from step 1 |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION` | Your bucket, `https://<account-id>.r2.cloudflarestorage.com`, `auto` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From the R2 API token |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | `smtp.resend.com`, `465`, `true`, `resend`, your Resend key |
| `EMAIL_FROM` | `Coursebook <hello@your-domain.com>` (a verified domain) |
| `ANTHROPIC_API_KEY` | From step 6 |
| `LEGAL_NAME`, `CONTACT_EMAIL`, `COPYRIGHT_AGENT` | Shown on the Terms, Privacy and Copyright pages (see [Legal](#legal-pages)) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional; see [Google sign-in](#google-sign-in) |

Never set `FAKE_CLAUDE` or `E2E_TEST` in production. The app refuses to start
with demo mode turned on.

## 8. Worker: Railway

1. In the same Railway project as Redis: **+ New → GitHub Repo →** this repo.
2. In the service's **Variables**, add everything from step 7, plus
   `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker`. That makes Railway build the
   worker image instead of guessing.
3. **Settings → Resources:** give it at least **1 GB RAM**. Measured usage is
   about 460 MB while idle (with the embedding model loaded) and about 750 MB
   while reading a scanned book with OCR. With `OCR_WORKERS=1` the peak drops by
   about 150 MB; `WORKER_CONCURRENCY=2` roughly doubles it.
4. Optional: **+ Volume** mounted at `/app/.models`. This keeps the 34 MB
   embedding model across deploys. Without it, the model downloads again at
   each start, which takes a few seconds.
5. Deploy. The logs should show `No pending migrations` (or the migrations
   being applied), then `[worker] ready`, `[worker] generation ready` and
   `[worker] embeddings ready`.

On each start the worker runs `prisma migrate deploy` before anything else. It
is the only place migrations run, so there's no race between services.

> **Fly.io / Render:** deploy `Dockerfile.worker` as a background worker (no
> port), with 1 GB RAM and the same variables.

## 9. Web app: Vercel

1. **Add New → Project →** import the repo. Vercel detects Next.js; keep the
   default build command (`npm run build`).
2. Add the variables from step 7 (Production, plus Preview if you want preview
   deployments to work).
3. Set **Settings → Functions → Region** to your database's region.
4. Deploy, then add your domain under **Settings → Domains**. If the address
   changes, update `APP_URL` on both services and redeploy.

Grading a whole test and tutor answers can take up to 2 minutes
(`maxDuration = 120` in those routes). Check that your Vercel plan allows
functions that long, or lower the value in
`src/app/api/assessments/[assessmentId]/submit/route.ts` and
`src/app/api/tutor/route.ts`.

**Updating:** push to `main`, and both services redeploy. If a release adds a
database migration, let the worker finish deploying (it applies the migration)
before the new web version takes traffic. Alternatively, run
`DATABASE_URL=<direct url> npm run db:deploy` from your computer first. The
migrations in this repo only ever add things, so a short overlap is harmless.

## 10. After the first deploy

1. Open `https://your-domain.com/api/health`. It should return `{"ok":true}`.
2. Sign up. The verification email should arrive from your domain.
3. Make yourself an admin, from your computer, using the **direct** database URL:
   ```bash
   DATABASE_URL="postgresql://…" npm run admin:grant -- you@example.com
   ```
   **Admin** now appears in your account menu.
4. Upload a small PDF. The status page should go through reading, OCR (if
   needed) and outline. Then generate one or two lessons, answer a written
   question, ask the tutor something, and download the Anki deck.
5. Open **/admin**. The Claude spend for those calls should be there, and
   **Failed work** should be empty.

### Google sign-in

In Google Cloud Console → Credentials → OAuth client → **Authorized redirect
URIs**, add `https://your-domain.com/api/auth/callback/google`. Then set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on both services.

---

## Usage limits

Each student has a plan (`FREE` or `PRO`, changed on the admin page). The
plan sets monthly allowances, which students see under **Settings → Plan and
usage**:

| | Free | Pro | Override with |
|---|---|---|---|
| Claude spend per month | $5 | $50 | `FREE_MONTHLY_AI_USD`, `PRO_MONTHLY_AI_USD` |
| Pages turned into lessons per month | 500 | 5,000 | `FREE_PAGES_PER_MONTH`, `PRO_PAGES_PER_MONTH` |
| Books kept | 10 | 100 | `FREE_MAX_BOOKS`, `PRO_MAX_BOOKS` |
| Storage | 2 GB | 20 GB | `FREE_STORAGE_GB`, `PRO_STORAGE_GB` |

Months follow the calendar (UTC). Hourly limits also apply:
`GRADING_PER_HOUR` (60), `TUTOR_PER_HOUR` (30), 10 uploads an hour, plus
request rate limits on downloads, answer checks and test submissions. Login,
sign-up and reset emails are rate-limited per IP address, stored in the
database so the limits hold across Vercel's many instances.

To charge for Pro later, a payment webhook (for example from Stripe) only
needs to set `user.plan`.

## Legal pages

`/terms`, `/privacy` and `/copyright` are complete, plain-language drafts that
describe what this code actually does. **They are not legal advice.** Before
you open the site to the public:

- Set `LEGAL_NAME` (you or your company), `CONTACT_EMAIL`, `COPYRIGHT_AGENT`
  (name and postal address; use `\n` for new lines), and `LEGAL_UPDATED`. Until
  `CONTACT_EMAIL` is set, the pages show a visible reminder.
- Have them reviewed for your country. If you add services (payments,
  analytics, error tracking), add those to the privacy policy.
- In the US, register a DMCA designated agent with the Copyright Office
  (copyright.gov/dmca-directory) to rely on the safe harbor.

## Security checklist

Already built in:

- Passwords are hashed and sessions are database-backed in httpOnly cookies
  (`Secure` on HTTPS). Email must be verified before logging in.
- Every query is scoped to the logged-in student. Integration tests check that
  one student can't reach another's data.
- CSRF protection: Server Actions are origin-checked by Next.js, and every POST
  route checks the `Origin` header.
- A Content-Security-Policy with a fresh nonce on every page (`src/proxy.ts`),
  HSTS on HTTPS, `nosniff`, a referrer policy, and frame protection.
- Uploads are checked for size, PDF signature and page count, and are stored
  privately behind short-lived signed links.
- The admin page re-checks the admin role in the database on every request.
  Everyone else gets a 404.
- `npm audit --omit=dev` reports no known vulnerabilities as of this release.

Your part:

- Keep the R2 bucket private. Keep `.env` out of git; it is already in
  `.gitignore`.
- Set an Anthropic spend limit.
- Use a long random `BETTER_AUTH_SECRET`. Changing it logs everyone out.
- Keep backups. Neon keeps point-in-time history (how far back depends on your plan).
  R2 holds the original PDFs; course content can be regenerated, but students'
  study history can't.
- Watch **/admin → Failed work** and the worker logs now and then.

## Running costs and capacity

One worker with the default settings writes about 3 lessons at a time
(`GENERATION_CONCURRENCY`) and reads one book at a time
(`WORKER_CONCURRENCY`). A 300-page book is read in a few minutes (longer if it
needs OCR), and its lessons take about 10–15 minutes. If books start queueing,
add a second worker instance (BullMQ shares the work safely) or raise
`WORKER_CONCURRENCY` with more RAM.

## Self-hosting on one server instead

Everything can also run on a single Linux server (2 GB RAM or more):
Postgres with pgvector and Redis (see `docker-compose.yml`), `npm run build &&
npm start` for the web app, and `npm run worker` for the worker. Both run under
a process manager such as systemd or pm2, behind a reverse proxy with HTTPS,
such as Caddy. With `STORAGE_DRIVER=local`, the web app and worker must share
the same `LOCAL_STORAGE_DIR`.
