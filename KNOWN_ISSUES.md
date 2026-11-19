# Known issues and what to do before real students use the site

The final review of Coursebook and The 1600 Project's setup on it, most serious first. "Before launch" items should be done before any real student signs up. Everything below was found by reading the code and running the full test suite and browser journeys. Nothing here is a known data leak: every permission and scope test passes (12 suites, 87 tests), as do the browser journeys for each role.

## Before launch (must do)

1. **The Privacy Policy and Terms of Use are drafts.** Both pages show a DRAFT banner listing what's missing:
   - who runs the program and how to reach them
   - whether the school needs a data agreement (FERPA)
   - parental consent for under-18s, and confirming every student is 13 or older (COPPA)
   - how long data is kept
   - governing law

   Complete them with your school and remove the `draft` lists in `src/app/(marketing)/privacy/page.tsx` and `terms/page.tsx`.

2. **Sign-up has an age confirmation, not a parental consent step.** Sign-up now asks people to confirm they're 13 or older and, if under 18, that a parent or guardian agrees (a checkbox; the Google button shows the same statement). It isn't verified. If the school requires recorded parental consent for minors, add it (or invite-only sign-up) before launch. This is tied to item 1.

3. **Confirm that the program admin may read every message thread.** Students are told on the messages page and in Help. Get the school's agreement that this matches its safeguarding policy.

4. **Sign-in limit vs. a classroom on one network:** resolved. Sign-in now allows 30 attempts per minute per IP address and sign-up 20 (`src/server/auth.ts`), enough for a class logging in together on school Wi-Fi.

5. **Production settings to double-check:**
   - `STAFF_TWO_FACTOR` must be unset (two-factor login enforced for staff).
   - `DEMO_LOGINS` must be unset or `false`. It's ignored when `APP_ENV=production`, but don't rely on that alone.
   - `SMTP_*` must be set. Without it, invites, notification emails and password resets fail. Failures are logged, not shown.
   - `FEATURED_PROGRAM_SLUG` must be `1600` on your school's deployment. Every new account starts in that program as a mentee (SAT only, no AI); without it, new accounts start unrestricted.
   - The 1600 Project's public page must be switched on from the program page: address `1600`, starting average 970, goal gain 300, "Public page is live".

## High

6. **Some "not found" pages answer with HTTP 200.** Pages with a loading screen stream their content, so when the server decides a page is out of scope (for example a Math specialist opening a Reading and Writing assignment), the browser gets the "Page not found" page with status 200 rather than 404. Nothing is shown: the browser tests assert on the content. Search engines and monitoring tools that read status codes may still count these as ordinary pages.

7. **Bulk messages and announcements sent *now* still send their emails during the request.** A message to 30 students sends up to 30 emails before the page answers (a few seconds with a slow mail server). Anything **scheduled** ("Send later") is sent entirely by the worker queue, so for those the page never waits. If immediate sends become slow, schedule them a minute ahead or move the "send now" path to the queue as well.

8. **Courses aren't copied by "Start a new semester".** Staff, scopes and groups carry over, but teachers re-add courses from each new class's Assign tab. This is noted in the admin guide and on the rollover form.

## Medium

9. **Badges are awarded when they're checked:** when the student opens Today, and hourly for students active in the last two days. A student who goes quiet for days doesn't get a badge until they come back. "Perfect attendance" uses calendar months in UTC.

10. **How the comparison charts average.**
    - "Groups over time" and "Classes over time" average every score added that month, not each student's latest score.
    - Group lines use each student's current group. A student who moves group takes their history with them.

11. **The calendar feed** (`/api/calendar/<token>.ics`) shows titles to anyone who has the link (the link can be reset), is cached for 15 minutes, and isn't rate-limited.

12. **Messaging is basic:**
    - no attachments
    - no editing or deleting messages
    - no reporting or blocking
    - the program admin can read every thread but not reply in them

    Message emails say who wrote, never what they wrote.

13. **The diagnostic needs a tagged question bank.** At least module 1 + module 2 questions per section, with confirmed tags. The demo seed doesn't build a diagnostic.

14. **Carried over from Phase 3** (deliberate simplifications):
    - Weekly summaries use direct AI calls, not the Batch API.
    - Score estimates are computed live, not stored nightly.
    - The SAT skill list is fixed in code, not editable by the admin.
    - "Ask about your class" questions aren't saved.
    - The worker's Dockerfile doesn't install `pg_dump`, so nightly backups need it on the host (deployment was out of scope).

15a. **College Board imports read columns by name.** College Board's export layouts change from year to year, so the class import matches headers by name (Email, Test, Test date, Total score, section scores, and the eight content-area names). It lists any column it ignores. Check the first real export with *Check* before *Add*. Knowledge and Skills bands are entered as 1–7 (the boxes on the report). The question-review paste reads tables copied from My Practice or Bluebook. If College Board changes that table, some rows may be skipped, and the form says which and why.

16a. **Needs attention is worked out when the page opens.** It reads each student's recent work, practice, scores and logs, so a program with hundreds of students makes the page slower (a few seconds). The sidebar count is kept for 5 minutes per server instance, so it can lag the list a little. Rules are fixed in code: accuracy down 15+ points (with at least 8 answers in each window), the same skill missed 3+ times in 30 days, more than 30 points below target pace. Only "Inactive after N days" is a program setting. "Handled" and "Snoozed" are shared by all of a program's staff, not per person.

16b. **Caseloads hold one primary tutor per student per program.** If a tutor stops teaching a student (removed from the class or group), the caseload link stays until the admin changes it; the tutor's needs-attention list still only shows students in their current scope.

16c. **Weekly practice only uses published bank questions with a skill.** Until the bank has 8+ published questions on a student's weak skills, that student is left out (the page says why). The rules are fixed in code (3 weakest skills, 4/3/3 split, last 60 days of results, nothing answered correctly in 30 days). A student in two classes of the same program gets one set a week, from whichever class's batch is built first. Specialists approve only sets whose skills are all in their subjects.

16d. **Live runs update by polling** (every 3 seconds for staff, 4 for students), not live push, so numbers can lag a few seconds and each open screen makes a small request that often. Sets are limited to 20 questions. A student answers each question once and can't change it.

16e. **Small groups use each student's single weakest skill.** A student appears in one group only. Program-wide groups can be messaged and assigned across classes, but a session is created class by class.

16f. **Scheduled sends need the worker.** Each one is a delayed queue job; the worker also checks every 15 minutes for anything due that the queue missed (for example after a Redis restart), so a send can be up to 15 minutes late but isn't lost. Times are entered in the browser's own time zone. Access is checked again when it sends: students who left the author's scope are skipped, and if the author lost the class entirely it fails with a notice. Scheduled messages can't be "pinned" or edited after they're sent, like any message.

16g. **Placeholders in announcements** fill only `{class}`: an announcement is one post for many readers, so `{first_name}` reads "everyone" and `{due_date}` reads "soon".

16h. **Parent progress emails are per program now.** The program admin chooses off, weekly (from Sunday 17:00 UTC) or monthly (from the 1st, 17:00 UTC). The old per-class "weekly guardian emails" switch is retired; the migration set programs that had it on for any class to weekly. A student in two programs gets the email from the program they joined first. At most `GUARDIAN_EMAILS_PER_HOUR` (default 200) go out each hour; the rest follow in the next hours, within 3 days. The email states facts from the data (no AI) and a "focus" skill from the last 30 days.

## Low

15. **Students see the Teaching section in the sidebar.** That's how anyone starts teaching a class, but it can confuse students. Consider hiding it until someone creates or joins a class as staff.

16. **Printed reports use the browser's "Save as PDF".** Page breaks depend on the browser. Charts print in the screen colours.

17. **The demo seed** uses the public page address `demo` and puts demo staff in New York time. `npm run seed:demo -- --remove` deletes all of it.

17a. **Demo mode** (`npm run demo:load`, or Admin → Demo data) shows these on the class screens:
- Avatars are stored for the demo students but never shown, because the app has no place that displays profile pictures yet.
- Groups, Attendance, Announcements, Curriculum and Review AI grades are empty; demo mode doesn't fill them. Use `npm run seed:demo` for a program that has them.
- The demo course has no original book file, so anything that opens the book's own pages (the PDF view and figures) has nothing to show. Lessons, practice, flashcards and unit tests work.
- The student who never started sees "Let's set up your first course / Upload a textbook" at the top of Today, even though they have overdue class work. The work is listed lower down, under "Assigned to you".
- On Trends, a Math-only class still lists all eight domains, including the Reading and Writing ones, which have no data. The score axis uses uneven tick values (1088, 1163).
- The tutor sees their own copy of the demo course on Today ("Your next lesson…"), as any teacher who owns a course does.

17b. **The SAT slide courses on the Hub** (`npm run hub:sat`):
- Their lessons have no practice questions or flashcards yet. A tutor or student can add them from the lesson's ⋯ menu → "New practice questions", which uses AI.
- The slides use the site's own font (Inter, or Arial if it isn't available), not the fonts set in the original artifacts, because the site only loads fonts it hosts itself.
- The Hub cards have no cover picture.
- Lessons change only when you rebuild and import again (ADMIN_GUIDE §10). Editing the artifacts doesn't update the site.

18. **Four database migrations** (`program_public_identity`, `calendar_token`, `badges` and `answer_indexes`) were generated with `prisma migrate diff` and applied with `migrate deploy`, because `migrate dev` can't run non-interactively in the build environment. They're ordinary SQL files. Review them like any migration.

## Checked and fine

- **Performance with 30 students and a year of data** (`npm run perf:check`): every staff and student page's server work takes under 40 ms warm. The hourly staff-notice job takes about 0.4 s for the whole program.
- **Pagination:** long lists are paged (messages, notifications, the audit log, sessions, the worksheet bank).
- **Accessibility:**
  - Every page the browser journeys visit passes axe (WCAG 2.1 AA) in light and dark mode.
  - The main pages have no sideways scrolling at 390 px wide.
  - The student and staff keyboard-only paths work, with visible focus at every step.
- **Dates** are shown in each person's own timezone.
