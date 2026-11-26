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
- **New accounts:** everyone who signs up starts in The 1600 Project as a mentee ("SAT only, no AI": their classes, practice sets, the SAT practice log and Desmos), from their first sign-in. They can't change it themselves. To give someone more (a tutor, or a student who should have AI features), change their rule in Admin → Program access, or on the program page's access rules. This needs `FEATURED_PROGRAM_SLUG=1600` on the deployment.
- **College Board questions:** Question bank → *College Board*. Upload a PDF (Question Bank exports, practice tests, handouts), screenshots, or pasted text. Claude copies each question word for word without the page clutter and tags its section, skill and difficulty; check them and press *Add*. They arrive as drafts marked "source: College Board". Questions with a picture or graph are flagged: add the image in the editor. Keep these inside your program's sets (College Board's terms allow using them to teach your own students, not posting them publicly). Each upload costs a few cents of AI (shown under Admin → AI spending as "College Board uploads").
- **Needs attention:** Teaching → Needs attention (with a count in the sidebar, and the top 3 on Today). One ranked list per staff member across all their classes, only students in their scope (a group or subject specialist sees only their students and subjects). Reasons: missed or late work, accuracy down 15+ points over the last 2 weeks against the 4 weeks before, no login and no practice for N days, the same skill missed 3+ times in 30 days (error log, mistake log, practice), and a score estimate more than 30 points below the straight line from baseline to target by the test date. Choose N on the program page ("Inactive after", default 7 days). Quick actions: message, assign a practice set (due in a week by default), mark handled (hidden until something new happens, for all staff), or snooze 1–30 days. Viewers see the list but can't act. Staff can get a daily count in Settings → Notifications ("Needs attention and caseload").
- **Weekly practice:** class → *Weekly practice*. Each week the worker builds every student a proposed set of 8–12 *published* bank questions aimed at their weakest skills (practice, class work, the error log and the mistake log from the last 60 days), leaving out questions they got right in the last 30 days or had in a recent weekly set. No AI. Staff get a "Waiting for review" notice. Remove or swap questions, take a student out, choose a due date and *Approve all*: each set becomes that student's own assignment (it doesn't appear in the bank's set lists). Students with too little data, or too few published questions on their weak skills, are listed as left out. The more questions you publish in the bank, the better these sets get.
- **Small groups:** class → *Small groups* (and program page → *Small groups* for the whole program). Students grouped by their weakest skill, biggest groups first, with the average accuracy on that skill. Message the group, assign a set for the skill, or create a session for them (this makes a class group named after the skill; teachers and the admin only).
- **Live warm-ups and exit tickets:** class → *Live*. Choose a published set of up to 20 questions and start; a big six-character code appears. Students join from Today ("Live now") or at `/live`. The screen updates every few seconds: how many answered, percent correct, and how many picked each choice. Reveal one answer or all; then close the run. It's saved to the session you chose (or a new one), everyone who answered is marked present, and every answer counts toward the student's practice history.
- **Assigning worksets:** class → *Assign* has a *Worksheet* card (a whole worksheet to the class, groups or chosen students) and a *Practice set* card. To send a published set to several classes at once, open the set in the question bank → *Assign to classes*.
- **Saved replies:** Messages → *Saved replies*. Write messages you send often, personal or shared with your program. Insert them when writing a message, a group message, a reply or an announcement. Placeholders are filled in for each student when it's sent: `{first_name}`, `{class}`, `{due_date}` (when their next assignment in that class is due, in their time zone). The owner, or the program admin for shared ones, can edit or delete them.
- **Scheduled sends:** tick *Send later* when writing a message, group message or announcement and choose a time. The worker sends it then (the page doesn't wait for emails). Until then it's under Messages → *Scheduled*, where you can edit or cancel it. You get a notice when it's sent, or if it couldn't be (for example you're no longer on the class). Settings → Notifications → "Scheduled sends".
- **Office hours:** Teaching → *Office hours*. Add weekly open times: a day, from–until (in your own time zone), slot length, the gap between slots, the most bookings a day, and the dates they apply between, plus where (a room or a video link). Days marked closed on the program's school calendar are skipped. Students book from **Office hours** in their menu: only staff who teach them (their class's teachers, specialists whose groups include them, and the program admin). They can add a note, cancel, or move a booking; at most 3 upcoming each. Both sides get a confirmation and a reminder about a day before (Settings → Notifications → "Office hours"), and bookings show on both calendars and in the calendar feed (the feed shows "Office hours booking", never the student's name). After the meeting, press *Attended* or *No-show*: it becomes a 1:1 session on the class's Attendance with that mark. The program admin sees every booking in the program and can cancel any.
- **Question reports:** students can press *Report this question* on any bank question in the practice player, and on worksheet questions in an assignment (wrong answer key, typo, confusing, figure missing, or other, plus an optional note). Reports keep the question's version and the student's answer, are anonymous to reviewers, and are limited to 20 a day per student. Bank questions go to Teaching → *Question reports* for every question author (the owner and tutors), and the question's author gets a notice (the owner, if it has none). Worksheet questions go to the worksheet's owner. Each question shows its reports together: mark it *Fixed* or *No change needed*, open it to edit, or (the author or the owner) unpublish it, which resolves its reports.
- **Question stats:** each bank question's page shows *How students did*: answers, % correct, average time and how often each choice was picked, for the current version on its own (older versions are counted separately, since an edit can change the question). The bank list has sortable columns (answers, % correct, average time, reports, flags) and a *Likely bad only* filter. A question is flagged when, with 10+ answers on the current version, it's far below the expected % correct for its difficulty (easy 75%, medium 55%, hard 35%, more than 30 points under), or one wrong choice is picked more often than the right one; or when it has 3+ open reports.
- **Caseloads:** program page → *Caseloads*. Give each student a primary tutor: a whole class or group at once, one student at a time, or a CSV (`student_email, tutor_email`; press *Check the file* first). A tutor must teach the student (a teacher of their class, or a specialist whose groups include them). The page shows each tutor's students, how many need attention, and when the tutor last messaged them. Tutors can filter Needs attention to "My caseload only"; students see their tutor on Today.
- **Program dashboard:** the button on the program page. Shows the average gain against the +300 goal, who's on track, who's stalling, and who has no baseline.
- **Messages:** students can message their own tutors; tutors can message the students in their scope, one at a time or a whole class or group (each student gets a private copy). As program admin you can read every conversation (Messages → Everyone in the program); you can't reply in other people's. Students are told this on the messages page. Either side can attach files to a reply (*Attach a file*): PNG, JPG or PDF, up to 10 MB each, 5 per message. The file's real type is checked from its contents, so a renamed file is refused. Pictures show in the conversation; PDFs open in a new tab. Files are only shown to the two people in the conversation and the program admin. Files attached but never sent are deleted after a day.
- **Announcements:** each class has an Announcements tab. Posts go to the whole class or one group and show on students' Today page, pinned first.
- **Calendar:** everyone's due dates, diagnostic windows, sessions and curriculum units, in their own timezone, with a private link for Google or Apple Calendar (resettable).
- **College Board results:** class → Scores → *Import College Board score reports* takes a CSV (from College Board's reporting portal or the template on that page: email, test, date, total, section scores, and each content area's Knowledge and Skills band 1–7). Press *Check* first; nothing is saved until *Add*. Students can also enter their own report's bands and paste a Bluebook/My Practice question review on their SAT scores page. Each student's page shows their **weak spots** (weakest areas and most-missed skills), and the class's Skills tab shows which areas are weakest for the most students. Question text is never read or stored.
- **Trends and reports:** each class has a Trends tab (groups and domains over time); the program dashboard compares classes and teachers. Printable progress reports and class summaries are on the Scores pages ("Save as PDF" in the print dialog).
- **Badges:** streaks, a cleared mistake log, domains mastered, gains and perfect attendance. Students see their own; staff see them on a student's page. No leaderboards.
- **Notifications:** the bell in the sidebar. Everyone chooses what shows there and what's emailed in Settings → Notifications. Emails say who wrote, never the message.
- **Review queue:** Teaching → Review queue. Claude never publishes anything by itself, so drafted questions, drafted lessons and AI grades wait here for a person.
- **Error emails:** if the site emails you "Coursebook error: …", open Admin → Errors and problem reports.
  - It shows what broke, on which page, and how often. Personal details are removed.
  - If it keeps happening, or students can't work, note the error id and the page, then follow §6.
  - Click **Mark fixed** once it's sorted.

### Program access

**Admin → Program access** limits who can use a program, by email (it also
works for people who haven't signed up yet):

- **Only this program**: the person can use that program's classes, their
  assignments and class courses, scores, calendar and messages, and nothing
  else: no uploads, no Hub, no other programs' classes, no programs of their
  own. Courses they already had are kept but can't be opened while the rule
  is in place.
- **Blocked from this program**: they can't join, teach in, be added to or see
  that program's classes or class courses. The rest of Coursebook works as
  usual. Removing the rule gives everything back; nothing is deleted.

Site admins can't be limited, and a program's own admin can't be blocked from
it (hand the program over first).

A program's admin can manage the same rules for their own program, on the
program's page (Teaching → the program → Program access). They can't set a
rule for their own account or for a site admin, and every change goes in the
program's audit log. Site admins see every program's rules in Admin.

### Email

**Admin → Email** shows how email is sent and has **Send me a test email**.
If sign-up links aren't arriving, start there: the result names the problem
(for example an unverified sender domain). See DEPLOY.md, step 5.

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
4. Under each class, *Copy its courses and question sets* is ticked when it has any. It adds the class's courses to the new class (students get a fresh copy when they open them) and copies its course-lesson and question-set assignments **with no due dates**. Set new dates on each class's Assign tab. Work for particular students, students' own weekly practice sets, worksheets and other kinds of assignment aren't copied (add those again). Untick it to start empty. The rollover, with what was copied, is recorded in the audit log.
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
| Email | `SMTP_*` | Your email service. Password reset, invites and alerts need it |
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
- **Academic Index:** reading application PDFs and grading essays use `CLAUDE_MODEL_ACADEMIC_INDEX` (shown as *Academic Index import* and *Essay grading* in Claude spend). Each changed essay is graded 3 times; students can score changed essays 5 times a day.
- **What runs on Claude:** see `PHASE3_SPEC.md` §7 for which model each feature uses. Most SAT work is multiple choice and grid-in, which is graded without Claude, for free.

## 9. Privacy requests

| Request | Who | Where |
|---|---|---|
| A student wants their data | The student | SAT scores → *Download all your tutoring records* |
| A student's data, for them | A teacher or you | Student's page → **Records** → *Download records* (logged) |
| Delete what the program holds about a student | Program admin | Student's page → **Records** → *Delete this student's data from the program* (type their name) |
| Delete a whole account | Site admin | Admin → **Delete an account** (or the person: Settings → Delete account) |

Backups age out after 30 days, so deleted data is gone from backups within a month.

**Academic Index:** a student's inputs and results are private to them. Tutors see a student's score, tier, breakdown and history only for classes the student shared it with, never their essays. Uploaded application PDFs are deleted as soon as the student confirms the review, or 24 hours after upload (the hourly maintenance job). Essays are stored only if the student ticks "Keep my essays saved here". Deleting the account deletes all of it.

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
| `npm run demo:load` / `npm run demo:clear` | Turn demo mode on or off (see below) |
| `npm run hub:sat` | Put the SAT Math and SAT EBRW slide courses on the Hub (see below) |

### The SAT courses on the Hub

**SAT Math** and **SAT EBRW** are The 1600 Project's own lesson slides, made into Hub courses. Every student can add them from the Hub for free.
- SAT Math: 14 lessons, 133 slides. SAT EBRW: 16 lessons, 128 slides.
- Each lesson shows its slides, with a text version underneath.
- Tutor speaker notes and blank template slides are left out.

To put them on the Hub, run `npm run hub:sat` once from a checkout of the repository with the production `.env` (like the other commands here), after `npm run admin:grant`. It uploads the slide PDFs to the site's storage and adds the courses to its database. The courses belong to the first site admin; to choose a different admin, run `npm run hub:sat -- --owner you@example.com`. Running it again skips courses that are already there. It uses no AI, so it costs nothing.

To take a course down, use **Hide from Hub** on the Hub page (as an admin). Students keep their copies.

To change a lesson, edit the slide artifact, download the decks, and rebuild:
1. Run `node scripts/hub/build-sat.cjs <folder of decks>` (`scripts/hub/sat-spec.json` lists the decks, units and slides left out).
2. Hide or delete the old Hub course.
3. Run `npm run hub:sat` again.

### SAT Master Courses and the in-house Question Bank

The SAT Math and Reading and Writing Master Courses use 4,125 official College Board Question Bank items. They're **in-house only**: you, plus the students and staff of classes you tick under **Admin → In-house content**. Everyone else, other tutors included, gets "not found" for the questions, their images, their sets and the courses.

1. Put `coursebook_sat_question_bank.json` and the `qbank_images/` folder in `data/course-packets/`. They're never committed to git.
2. Import the bank, then the courses. Add `-- --dry-run` first to check. Both are safe to run again.
   ```
   npm run import:bank
   npm run import:courses
   ```
   Run them with the production `.env`, so the images go to production storage.
   **Turning the images into text** (math as LaTeX). Do this before step 2, or run `npm run import:bank` again after it. It needs an Anthropic API key in `COURSEBOOK_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`; in Claude Code cloud sessions `ANTHROPIC_API_KEY` may not reach commands, so use the first name there).
   ```
   npm run transcribe:bank -- --dry-run      # how many items, and a cost estimate
   npm run transcribe:bank -- --sample 20    # 20 items now, to check the quality
   npm run transcribe:bank                   # the rest, as a batch (half price; usually within a few hours)
   ```
   An item becomes text only if Claude's own answer matches the official key and its math renders. A graph or diagram is cut out and shown with the text. Everything else keeps its image and waits in **Course Studio → Transcriptions**: compare it with the image and choose **Use text** or **Keep image**. Re-importing keeps your choices. The results file (`qbank_transcriptions.json`) is never committed.
3. Open **Course Studio → Video review** and approve the videos. Students only see approved ones.
4. **Course Studio → Sets** shows each set's size and difficulty mix, with a Reshuffle button.
5. Preview a lesson with **Preview as student**. When the course is ready, use **Publish → to in-house classes**.
6. Tick the 1600 Project classes under **Admin → In-house content**.

**Kill switch:** set `ALLOW_COLLEGE_BOARD_CONTENT=false` to hide every College Board question and set from everyone, you included. Do this before any public release.

### Writing original questions from the blueprints

`data/blueprints/sat-blueprints.json` holds the 1600 Project's question recipes ("blueprints"): the technique each question tests, how to build it, the mistake behind each wrong answer, and how many questions to write. `npm run generate:bank` has Claude write original questions from them only, never from College Board items. A second, separate request then solves each question cold and grades it, and only questions that pass are kept.

1. `npm run generate:bank -- --dry-run`: how many requests, and a cost estimate. It makes no API calls.
2. `npm run generate:bank -- --sample 20`: writes 20 questions right away, across many blueprints, so you can check quality. It shows why each one was kept or dropped.
3. `npm run generate:bank`: writes the rest as half-price batches, then verifies them. It waits until both are done; if it's stopped, run it again with `-- --collect`. Add `-- --only E12,E13` to write questions for just those blueprints.

It needs an API key in `COURSEBOOK_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`).

**What gets kept.** A question is kept only if all of these are true:
- The cold solve gets the same answer.
- No serious problem was found: two defensible answers, a math error, a doubtful fact or ambiguous wording.
- It rates at least 4/5 for SAT quality.
- Its difficulty is within one level of the level asked for.

**Where the output goes.**
- Kept questions go to `data/questions/1600-generated-questions.json` as drafts, in the bank's import format.
- Working files and the reasons each question was dropped go to `data/generated/`, which is never committed.

### Demo mode

Demo mode fills the site with an invented class so you can see and try the class features without real students. Turn it on or off from **Admin → Demo data** (Load demo data / Clear demo data), or with `npm run demo:load` and `npm run demo:clear`.

It creates one tutor (Jordan Whitfield), the class **Demo: SAT Math** in a "Demo Tutoring Program", and 10 invented students:
- 2 strong, 5 average and 3 struggling
- one of the struggling students never started

It also adds:
- a short made-up textbook, *Foundations of SAT Algebra*, turned into a 4-chapter course with lessons, practice questions, flashcards and unit tests
- lesson progress, quiz answers and unit-test results that match each student's level
- a PSAT baseline and an October Bluebook practice score with College Board bands
- three assignments: one everyone finished, one with late and missing work, and one due next week
- a Math diagnostic
- a few tutor chats

Sign in as `tutor@demo.coursebook.invalid`, or as `student1@demo.coursebook.invalid` to `student10@demo.coursebook.invalid`. The password for all of them is `coursebook-demo-mode`.

Every demo record is flagged `isDemo`. Clearing deletes the demo accounts and everything they own in one step, and real accounts and data are never touched. Real students can't join the demo class, even with its code. Demo mode is refused on a production deployment (`APP_ENV=production`) unless you set `DEMO_DATA_ALLOWED=true` there on purpose.
