# Admin guide: running a program on Coursebook (The 1600 Project)

This guide is for whoever runs the site: right now that's the program's president, and later a teacher or a younger student who takes over. You don't need to be a programmer for most of it. Where a step needs a terminal, the exact command is given.

**Two kinds of admin:**
- **Program admin:** runs The 1600 Project inside the site (staff, classes, settings). Set on the program page; can be handed over (see below).
- **Site admin:** sees the Admin page: errors, problem reports, AI spending, deleting accounts. Set with `npm run admin:grant -- someone@example.org` on the server.

Usually one person is both.

---

## 1. Day to day

- **Program page:** Teaching → My classes → your program's name. It has:
  - settings: score targets, how long staff invites last, the daily AI cap, official SAT dates
  - **public page:** the program's own page at `/p/<address>` (for example `/p/1600`) with its badge, starting average, goal gain and a short description. It stays off until you choose an address and tick "Public page is live". To feature it on Coursebook's front page, set `FEATURED_PROGRAM_SLUG=1600` on your deployment (leave it empty to feature none).
  - the school calendar
  - handing over the admin role
  - the audit log
- **Program dashboard:** the button on the program page. Shows the average gain against the +300 goal, who's on track, who's stalling, and who has no baseline.
- **Messages:** students can message their own tutors; tutors can message the students in their scope, one at a time or a whole class or group (each student gets a private copy). As program admin you can read every conversation (Messages → Everyone in the program); you can't reply in other people's. Students are told this on the messages page.
- **Announcements:** each class has an Announcements tab. Posts go to the whole class or one group and show on students' Today page, pinned first.
- **Calendar:** everyone's due dates, diagnostic windows, sessions and curriculum units, in their own timezone, with a private link for Google or Apple Calendar (resettable).
- **Trends and reports:** each class has a Trends tab (groups and domains over time); the program dashboard compares classes and teachers. Printable progress reports and class summaries are on the Scores pages ("Save as PDF" in the print dialog).
- **Badges:** streaks, a cleared mistake log, domains mastered, gains and perfect attendance. Students see their own; staff see them on a student's page. No leaderboards.
- **Notifications:** the bell in the sidebar. Everyone chooses what shows there and what's emailed in Settings → Notifications. Emails say who wrote, never the message.
- **Review queue:** Teaching → Review queue. Claude never publishes anything by itself, so drafted questions, drafted lessons and AI grades wait here for a person.
- **Error emails:** if the site emails you "Coursebook error: …", open Admin → Errors and problem reports.
  - It shows what broke, on which page, and how often. Personal details are removed.
  - If it keeps happening, or students can't work, note the error id and the page, then follow §6.
  - Click **Mark fixed** once it's sorted.

## 2. Staff

| To… | Do this | Notes |
|---|---|---|
| Add someone | The class → **Staff** → *Add someone*: their email and a role | |
| Change a role or scope | **Change role** on their row | Takes effect on their next click |
| Remove someone | **Remove** on their row | They lose access immediately |
| Reset a lost phone | **Reset two-factor** on their row | Only after you've confirmed it's really them; they set it up again at their next login |
| Resend or cancel an invite | The *Invited, not joined yet* list | |

**Roles:**
- **Teacher:** everything in the class.
- **Specialist:** only the subjects and/or groups you tick. Student tutors are specialists limited to their group; make the group first on the **Groups** tab.
- **Viewer:** read-only (for example a counselor).

**Adding someone:**
- If they already have an account, they get access right away.
- Otherwise they get an invite link, valid for 7 days by default.

**Letting a teacher manage staff:** only you can add or remove staff, unless you tick *Can add, change and remove staff* for a teacher.

**Two-factor login is required for staff.** New staff set it up the first time they open Teaching: Settings → Two-factor login, using an authenticator app.

Every change is recorded in the program's audit log.

## 3. Handing over the admin role (for example when you graduate)

1. Make sure the new admin is on the staff of at least one class.
2. Program page → **Hand over the admin role** → choose them → type the program's name → confirm.
3. They're the admin immediately and get an email. You stay on every class as a teacher until you remove yourself.
4. Hand over the **keys and accounts** too (§7): the hosting, database, email and Anthropic accounts. Then change the passwords and API keys you know.
5. If you're also the site admin, have them run `npm run admin:grant -- their@email` (or ask whoever has server access).

If the admin leaves without handing over, the site admin can make someone else the program admin. That's in the code (`transferAdmin` with `asSiteAdmin`); ask a developer to run it.

## 4. A new semester

At the end of a term, use **Program page → Start a new semester**:
1. Name the semester (for example *Spring 2027*) and tick the classes to carry forward.
2. Each one gets a fresh copy: same teacher, same staff with the same roles and scopes, the same groups (empty), and a **new join code**. The old classes are archived (read-only). Scores, answers, attendance and mistake logs stay with the students.
3. Optionally tick *Email last semester's students an invite*; otherwise share the new codes, or import a roster (class → Students → *Import a roster*, a CSV with name, email, group, target).
4. Add courses again from each new class's Assign tab (they aren't copied). The rollover is recorded in the audit log.
3. Update the **school calendar** (program page) and import or reuse the **curriculum** (class → Curriculum → *Start from the SAT template*, or paste your syllabus).
4. Update the **official SAT dates** in the program settings.
5. Worksheets, the question bank and diagnostics belong to you, not to a class, so they carry over.

## 5. Backups

**What gets backed up.** The worker takes a full database backup every night at 03:00 UTC (when `BACKUPS_ENABLED=true`). It saves it in file storage as `backups/YYYY-MM-DD.sql.gz` and keeps 30 days. The worker needs the `pg_dump` tool, from the `postgresql-client` package. Your database host's own backups are a second copy.

**Take one now.** On the server or your PC, with the production `.env`:

```
npm run backup:now
```

**Restore** (practise this once a term):
1. Download the backup file from your file storage (for example the R2 or S3 dashboard).
2. Create an **empty** database to test with. Never restore over the live one unless the live one is lost.
3. Load it:
   ```
   gunzip -c 2026-11-10.sql.gz | psql "postgresql://user:password@host:5432/empty_database"
   ```
4. To check it, point a copy of the site at it (staging is ideal) and look at a class.

**If the live database is lost:** restore the newest backup into a new database, set `DATABASE_URL` to it, and run `npm run db:deploy`. That applies any newer database changes.

## 6. Deploying updates

The hosting setup is decided separately, so check your host's own instructions. The routine is the same anywhere:

1. Changes go on a branch and are tested: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run test:e2e` for the browser test.
2. Push to the **`staging`** branch. The staging copy updates. Try it there; it holds fake data only.
3. Merge into **`main`**. The live site updates. Database changes apply on deploy with `npm run db:deploy`.
4. **If something's wrong:** redeploy the previous version from your host's dashboard. Database changes are written to be added on top, so the previous version keeps working.

**The staging copy:**
- Set `APP_ENV=staging` and `PRODUCTION_DATABASE_URL` on it. It then **refuses to start** if it's ever pointed at the live database, and shows a "Staging copy" bar.
- Give staging its own Anthropic key with a low limit, or `FAKE_CLAUDE=true`.

## 7. Keys and accounts (what to hand over)

All secrets are environment variables on the host. `.env.example` lists every one and what it's for. They are **never** written into the code or committed.

| What | Variables | Where it comes from |
|---|---|---|
| Database | `DATABASE_URL` | Your database host |
| Redis (the job queue) | `REDIS_URL` | Your host |
| Logins | `BETTER_AUTH_SECRET` | A long random string; changing it logs everyone out |
| Email | `SMTP_*` | Your email service. Password reset, invites, alerts and guardian emails need it |
| File storage | `S3_*` | R2 or S3 |
| Claude | `ANTHROPIC_API_KEY` | console.anthropic.com. Also set a monthly spending limit there |
| Desmos (optional) | `DESMOS_API_KEY` | desmos.com/api, free; accept its terms |
| Backups | `BACKUPS_ENABLED`, `BACKUP_RETENTION_DAYS` | Your choice |
| Staging | `APP_ENV`, `PRODUCTION_DATABASE_URL` | Your choice |
| Staff two-factor | `STAFF_TWO_FACTOR` | Leave as `required` in production |

**When the person running the site changes:** create new keys for Anthropic, email and storage, update them on the host, and delete the old ones.

## 8. Money: AI spending

- **Monthly cost:** Admin → *Claude spend* shows this month's spend by feature.
- **Daily cap:** set one on the program page. If the program reaches it, AI features (grading written answers, the tutor, worksheets, the assistant) pause until midnight UTC, and you get an email.
- **Monthly limit:** also set one in the Anthropic console, as a second safety net.
- **What runs on Claude:** see `PHASE3_SPEC.md` §7 for which model each feature uses. Most SAT work is multiple choice and grid-in, which is graded without Claude, for free.

## 9. Privacy requests

| Request | Who | Where |
|---|---|---|
| A student wants their data | The student | SAT scores → *Download all your tutoring records* |
| A student's data, for them | A teacher or you | Student's page → **Records** → *Download records* (logged) |
| Delete what the program holds about a student | Program admin | Student's page → **Records** → *Delete this student's data from the program* (type their name) |
| Delete a whole account | Site admin | Admin → **Delete an account** (or the person: Settings → Delete account) |

Backups age out after 30 days, so deleted data is gone from backups within a month.

Before real students use the site, go through `PRIVACY_REVIEW.md` with your school.

## 10. Useful commands

Run these on a machine with the production `.env`, or locally:

| Command | What it does |
|---|---|
| `npm run admin:grant -- email` | Make someone a site admin |
| `npm run backup:now` | Take a database backup now |
| `npm run db:deploy` | Apply database changes |
| `npm run cost:breakdown` | AI cost by step for a course |
| `npm test` / `npm run test:e2e` | Run the tests |
