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

2. **Sign-up has no age check or parental consent step.** Anyone with an email address can create an account. If the school requires consent for minors, add it to sign-up (or invite-only sign-up) before launch. This is tied to item 1.

3. **Confirm that the program admin may read every message thread.** Students are told on the messages page and in Help. Get the school's agreement that this matches its safeguarding policy.

4. **Sign-in limit vs. a classroom on one network.** Sign-in is limited to 5 attempts per minute per IP address (`src/server/auth.ts`, the `"/sign-in/email"` rule). A class logging in together from school Wi-Fi shares one IP, so the 6th student in a minute is told to wait. Decide whether to:
   - raise the limit (for example to 30 a minute),
   - stagger log-ins, or
   - accept it.

   The browser tests work around it by clearing the limiter between test accounts. The limit itself is unchanged.

5. **Production settings to double-check:**
   - `STAFF_TWO_FACTOR` must be unset (two-factor login enforced for staff).
   - `DEMO_LOGINS` must be unset or `false`. It's ignored when `APP_ENV=production`, but don't rely on that alone.
   - `SMTP_*` must be set. Without it, invites, notification emails and password resets fail. Failures are logged, not shown.
   - `FEATURED_PROGRAM_SLUG` should be `1600` on your school's deployment.
   - The 1600 Project's public page must be switched on from the program page: address `1600`, starting average 970, goal gain 300, "Public page is live".

## High

6. **Some "not found" pages answer with HTTP 200.** Pages with a loading screen stream their content, so when the server decides a page is out of scope (for example a Math specialist opening a Reading and Writing assignment), the browser gets the "Page not found" page with status 200 rather than 404. Nothing is shown: the browser tests assert on the content. Search engines and monitoring tools that read status codes may still count these as ordinary pages.

7. **Bulk messages and announcements send their emails during the request.** A message to 30 students sends up to 30 emails before the page answers. That's a few seconds with a slow mail server. If it becomes a problem, move notification emails to the worker queue.

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

## Low

15. **Students see the Teaching section in the sidebar.** That's how anyone starts teaching a class, but it can confuse students. Consider hiding it until someone creates or joins a class as staff.

16. **Printed reports use the browser's "Save as PDF".** Page breaks depend on the browser. Charts print in the screen colours.

17. **The demo seed** uses the public page address `demo` and puts demo staff in New York time. `npm run seed:demo -- --remove` deletes all of it.

18. **Four database migrations** (`program_public_identity`, `calendar_token`, `badges` and `answer_indexes`) were generated with `prisma migrate diff` and applied with `migrate deploy`, because `migrate dev` can't run non-interactively in the build environment. They're ordinary SQL files. Review them like any migration.

## Checked and fine

- **Performance with 30 students and a year of data** (`npm run perf:check`): every staff and student page's server work takes under 40 ms warm. The hourly staff-notice job takes about 0.4 s for the whole program.
- **Pagination:** long lists are paged (messages, notifications, the audit log, sessions, the worksheet bank).
- **Accessibility:**
  - Every page the browser journeys visit passes axe (WCAG 2.1 AA) in light and dark mode.
  - The main pages have no sideways scrolling at 390 px wide.
  - The student and staff keyboard-only paths work, with visible focus at every step.
- **Dates** are shown in each person's own timezone.
