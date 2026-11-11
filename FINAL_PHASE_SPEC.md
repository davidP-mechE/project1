# Final phase: completeness and polish

Phase 3 is built (see `PHASE3_SPEC.md`). This phase makes the site feel finished. Hosting and deployment are out of scope: you're handling them separately, so nothing here changes them.

## 1. What already exists (skipped or only extended)

| Asked for | Already there | This phase |
|---|---|---|
| Practice streaks | Daily study streak, XP, levels and quests (sidebar and Today) | Add **badges**; check there's no score leaderboard (there isn't) |
| Profile and account settings | Email change, password change, account deletion, timezone (under Studying) | Add **name**; gather everything under one **Account** section |
| Notification settings | Daily study reminder on/off and hour; staff alert digest (no UI yet) | One **Notifications** page for every email and in-site alert |
| Charts over time | Program dashboard: gain by month; class Scores; Skills | Add **comparison charts**: groups, teachers and domains over time |
| Printable reports | Printable course pages (`/print/courses/…`) | Add a **student progress report** and a **class summary** |
| Semester rollover | Archiving one class at a time; score history kept | A **new semester** step for the whole program |
| Landing page | A generic Coursebook landing page | Rewrite as a **Coursebook** landing page, with a "Programs on Coursebook" section; The 1600 Project gets its own public page |
| Privacy and terms | Template pages | Mark clearly as **drafts** for you and your school |
| Loading and error states | `loading.tsx` on some pages; a global error page | Add to every page group, plus empty states everywhere |
| Accessibility | Automatic checks (axe) on most pages in light and dark mode; phone-width check on many pages | Every page, a keyboard-only walk-through, focus checks |
| Timezones | Stored per user; used for reminders | **Every** date and due time shown in the viewer's timezone (19 places currently use the server's) |
| Error, empty and demo data | Demo mode for AI (`FAKE_CLAUDE`) | **Demo seed** with realistic fake people and a year of data |

## 2. What's added, in build order

**1. Visual identity proposals (first, so you can choose while the rest is built).**
- Three directions, each with a short description and a sample page (a student's SAT scores page) rendered as an image.
- **Nothing is restyled until you choose.**

**2. Foundations.**
- A `formatInZone` helper; every page passes the viewer's timezone. Server-rendered dates stop using the server's clock zone.
- `NotificationPrefs` (per user, per type: email and/or in-site).
- An in-site **notification center**: a bell in the sidebar with unread counts. Messages, announcements, alerts and drafts waiting for review land there.
- Profile: name.

**3. Messaging.**
- Threads between staff and students.
  - **Staff:** can start a thread only with students in their scope (a Math specialist limited to group B can message group B only).
  - **Students:** can message only their own tutors: teachers of their classes, and specialists whose scope includes them.
  - **The program admin:** can read every thread in the program (shown as "Visible to the program admin").
- Bulk message: one message to a class, group or chosen students, sent as one thread each.
- Optional email notifications (respecting notification settings). Rate-limited.
- Models: `MessageThread` (`programId`, `classId`, `studentId`, `staffId`), `Message` (`threadId`, `authorId`, `body`, `createdAt`), `ThreadRead` (`threadId`, `userId`, `lastReadAt`).

**4. Announcements.**
- Staff post to a class or a group (within their scope). They show on students' Today page and in the notification center, and can be pinned or edited.
- Model: `Announcement` (`classId`, `groupId?`, `authorId`, `title`, `body`, `pinned`, `createdAt`).

**5. Calendar.**
- **Shows:** due dates, diagnostic windows, class sessions, curriculum units and the student's test date.
- **Who sees what:** students see their own; staff see their classes, filtered by scope.
- **Views:** month grid and agenda list (the agenda is the phone default), each in the viewer's timezone.
- **Subscribe link:** a private ICS feed for Google or Apple Calendar, with a revocable token and no personal details in the event text beyond titles.

**6. Badges.**
- **Which:** 5-, 10- and 30-day study streaks; mistake log cleared; domain mastered (85%+ on 20+ answers in a domain over 30 days); first diagnostic; +100 and +200 points over baseline; perfect attendance for a month.
- **Where they show:** awarded on activity, visible to the student, and to staff in scope on the student's page.
- **No leaderboards:** nothing ranks students against each other.
- Model: `Badge` (`userId`, `kind`, `earnedAt`, `detail`).

**7. Comparison charts (admin and teachers).**
- **Groups over time:** average score by month per group.
- **Teachers:** average gain of their classes' students.
- **Domains over time:** class accuracy per domain by month.
- **Shared chart style:** the same colors, labels and data-table fallback for screen readers.
- **Scope:** teachers see their classes; the admin sees the program; specialists see their scope.

**8. Printable / PDF reports.**
- **Per-student progress report:** score history, gains, domains, attendance, mistake log, plan.
- **Per-class summary:** class stats, distribution, domain accuracy, attendance.
- **Format:** print-optimized pages ("Save as PDF" in the browser). No new server software, so no deployment change.
- **Access:** scoped like the screens they come from.

**9. Semester rollover.**
- Program page → **Start a new semester**.
  1. Name the semester.
  2. Choose which classes to carry forward. Each gets a fresh copy with the same staff, scopes and groups (empty), and a new join code.
  3. Choose whether to re-invite last semester's students.
- Old classes are archived. Scores, answers, attendance and mistake logs stay with the students.
- Audited.

**10. Public pages.**
- **Coursebook landing page:** courses from textbooks and slides, plus tutoring programs (classes, staff roles, scores, diagnostics, mistake log, messaging), with log in and sign up. A "Programs on Coursebook" section features one program when `FEATURED_PROGRAM_SLUG` is set (your school's deployment: `1600`; a commercial one: empty).
- **A program's public page (`/p/<slug>`):** The 1600 Project's copy (a school average of about 970, the +300 goal, targets of 1200 and 1300, how it works) lives on its Program record, set by its admin, and shows with its seal, the gauge example, and sign-up and log-in buttons.
- **Help and FAQ:** separate sections for students and for staff.
- **Privacy Policy and Terms of Use:** a clear "Draft: to be completed with the school" banner on each, with the open items listed.

**Brand rule (your correction):** Coursebook is the product and the site's name everywhere: tab titles, the logo and favicon, headers, footer and emails. The 1600 Project is one program on it. Its name, badge and public copy are program data, shown inside the app only where they apply (its classes, its dashboard, and its students' Today and SAT scores pages). Students in no program never see it.

**11. Design system and restyle (after you choose).**
- Tokens for color, type, spacing, radius and elevation in `globals.css`, plus shared components.
- **Signature touches:**
  - a Coursebook logo and wordmark (an open book in ink and gold); the "1600" seal is only The 1600 Project's program badge
  - a distinctive score display (a 400–1600 gauge with goal markers)
  - one chart style used everywhere
- **Kept:** the navigation, page structure, readability on phones, and AA contrast.

**12. Quality pass.**
- **Every page:** loading, empty and error states.
- **Consistent design:** every page follows the system.
- **Full accessibility audit:**
  - axe on every page in both themes
  - keyboard-only walk-throughs of the main tasks
  - visible focus everywhere
  - landmarks and labels
- **Phone width:** every page checked at 390 px.
- **Timezones:** applied everywhere.
- **Performance:**
  - a seed of 30 students with a year of data
  - query timing on the heavy pages, with indexes added where needed
  - pagination on long lists: messages, the audit log, scores, the worksheet bank, sessions
- **Demo mode:**
  - `npm run seed:demo` creates a demo program with fake names (no real people) and a year of realistic activity
  - log-in buttons for a demo admin, teacher, specialist and student

**13. End-to-end tests.**
- **One browser journey per role:**
  - **Admin:** sets up a program and class, adds staff.
  - **Specialist:** grades within their scope and can't see the rest.
  - **Student:** joins by invite, takes a diagnostic, completes assignments, sees their scores.
- **Plus:** the whole permission and scope suite re-run, extended to messaging, announcements, the calendar, reports, badges and rollover.

**14. Final review → `KNOWN_ISSUES.md`.**
- Remaining bugs, risky areas, and what to fix before real students use the site, ordered by severity.

## 3. Roles for the new features

| Feature | Student | Specialist | Teacher | Viewer | Program admin |
|---|---|---|---|---|---|
| Messaging | Own tutors only | Students in scope | Students in their classes | – | Students in the program; reads all threads |
| Announcements | Read their class's and groups' | Post to their groups or subjects' classes | Post to their classes | Read | Post anywhere |
| Calendar | Own | Scope | Their classes | Their classes | Program |
| Badges | Own | Students in scope | Their classes | Their classes | Program |
| Comparison charts | – | Scope | Their classes | Read | Program |
| Printable reports | Own progress report | Students in scope | Their classes | Read | Program |
| Semester rollover | – | – | – | – | Yes |

## 4. Risks and open questions

- **Admin reading all threads:** students are told on the messaging page that the program admin can read messages. Confirm with the school that this is acceptable; it's a common safeguarding rule.
- **Email volume:** new messages and announcements could send many emails. Defaults are in-site plus a daily email digest, not one email per message.
- **Calendar feed:** the link is secret but not password-protected; anyone with it sees the event titles. It can be revoked and regenerated.
- **Restyle timing:** it waits for your choice. If it comes late, the quality pass runs again on the new look.
