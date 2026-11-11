# Phase 3 spec: tutoring programs in Coursebook (first program: The 1600 Project)

Status: **approved for building (10 Nov 2026)**, with the changes in §0.1. *Suggested additions* (§14) are not approved yet and won't be built until you pick them.

## 0. Context

**The feature.** Phase 3 adds a general **tutoring programs** feature to Coursebook: anyone running a tutoring program can set one up, add staff and students, and track progress. SAT-specific parts (the domain list, score scales, diagnostics) are the first subject template; nothing is hard-coded to one program.

**The first program.** The 1600 Project is **your own** SAT prep program (not run by the school): you as admin, 2 teachers, possibly student tutors, and about 15–30 students to start. The school average is about 970. The goal is a **+300-point average gain**, with student targets of **1200** and **1300**.

**What already exists (Phases 1–12 plus this phase), and which Phase 3 builds on:**

- **Courses from textbooks or slide decks:** lessons, practice questions, flashcards, unit tests, the tutor, exports.
- **Spaced repetition** for flashcards and missed questions.
- **Error log, Review drills, and Mastery by subject.**
- **Classes:**
  - join codes and invite links
  - assigning lessons from a course, or worksheet questions
  - timed question sets with a server-kept clock
  - a progress grid, per-question analysis and a skills report
- **Worksheets:** a teacher uploads a PDF, Claude lists its questions and answers, and the teacher reviews them.
- **Platform:** plan limits with a monthly AI allowance, rate limits (login, answers, uploads), account deletion, an admin page, a phone layout, and WCAG AA checks in the browser test.

**Terminology this spec uses.** Your messages say "course" for a group of students (for example "add specialists to a course"). In the app, a *course* is study material made from a book or slides, so this spec uses:

- **Program:** a tutoring program as a whole (yours is The 1600 Project). It has one **program admin**, which can be transferred.
- **Class:** a cohort run by one or more teachers, like today's classes (for example "SAT Fall 2026").
- **Group:** a subset of a class (a score band, a weak domain, a session time).
- **Course:** study material, as today.

✅ **Decided:** a specialist is added to a **class** (with a scope of domains and/or groups), not to a course. Where your notes say "add staff to a course", this spec means a class.

### 0.1 Changes in this revision

- The 1600 Project is your own program, and the feature is general: **Program** is a first-class model with its own admin (§2 F0).
- **Specialists and staff roles** are rewritten to your final list (F1), including **transferring the admin role** and **teachers and specialists reviewing AI grades for their own groups**.
- New: **official College Board practice by link only** (S6).
- **Deployment** (§11): I explain the options and wait for your choice before signing up for or configuring any service; a staging copy; an AI spending cap; your program's data kept in its own setup, separate from a future commercial version.
- New: **documentation and handoff** (§11.1): an admin guide and a privacy-review note.
- **Groups** (C1) move into the foundations, because staff scopes use them.

### Rules that apply to every feature

1. **No College Board or Bluebook content.** No official questions are stored. Questions must be original (written by staff, or drafted by AI and reviewed) or licensed. Official tests are supported for **score entry only**: totals, section scores, and the numbers and domains of missed questions, never question text. Uploads carry a rights checkbox that says this, and the worksheet reader is told not to treat official materials as source.
2. **Student data is sensitive.**
   - Every server function checks role and scope, not just the UI.
   - No student data in URLs (ids only, never names, emails or scores) and no student data in logs. Errors are logged with ids only, and the Report-a-problem feature strips form contents.
   - See §8 (privacy) before real students use the site.
3. **Permission tests.** Every permission rule gets a test: who can see and who can edit what. This is a table-driven suite (§9).
4. **Cost-aware AI.**
   - Each AI feature lists its model (§7), defaulting to the cheapest that holds quality.
   - Everything AI-generated (questions, lessons, grades, summaries students might see) goes to a staff review queue. Nothing reaches students or becomes final without staff approval, and staff can override any AI grade.

---

## 1. Build order (by dependency)

| Step | Feature | Depends on | Risk |
|---|---|---|---|
| 1 | **F0** Programs and admin transfer; **F2** SAT domains and skills; **C1** groups | – | Low |
| 1 | **F1** Roles, staff and scopes (Specialists, invites, Staff page, audit log) | F0, F2, C1 | **High**: everything relies on it |
| 3 | **F3** Question bank and versioning | F2 | Medium |
| 4 | **F4** Security baseline (2FA, audit log, rate limits) | F1 | Medium |
| 5 | **S1** Baseline score; **S2** outside score entry; **S6** College Board practice by link | F1, F2 | Low |
| 6 | **P1** Adaptive SAT-style diagnostics | F2, F3, S1 | **High**: scoring is an estimate |
| 7 | **P2** Mistake log; **P3** Desmos; **P4** test date and pacing | F3, P1 | Medium (P3: Desmos licensing) |
| 8 | **S3** Score history; **S4** program dashboard; **S5** projection and stalling | S1, S2, P1 | Medium (projection accuracy) |
| 9 | **C2–C6** Assign to groups, attendance, bulk actions, alerts, parent email | F1, C1, S-series | Medium (parent email consent) |
| 10 | **A1–A5** Curriculum import and AI assistant | F2, C1, S-series | Medium (AI quality and cost) |
| 11 | **R1–R10** Reliability, security and support | runs alongside steps 1–10 | Low–medium |
| 12 | **D1** Deployment code (backups, staging guard, AI cap, health checks); the hosting setup itself waits for your choice of services | F4 | Low |
| 13 | **H1** Admin guide; **H2** privacy-review note | everything | Low |

I'd build in releases of 1–3 steps. Each release ends with its permission tests, the browser journey, and screenshots.

---

## 2. Foundations

### F0. Programs and the admin role

**What it does.**
- A **program** groups classes, staff and students (yours: The 1600 Project). Its settings hold the subject template (SAT for now), score targets (1200, 1300; editable), test dates, and the AI spending cap.
- The **program admin** (you) has full access to everything in the program.
- **Transferring the admin role:** you pick a staff member, type the program name to confirm, and they become admin. You stay on as a teacher unless you remove yourself. The new admin gets an email, and the transfer goes in the audit log. Only the current admin can transfer the role (and the site admin can, as a recovery path if the admin leaves without handing over).
- Every class belongs to one program. Existing classes move into a program for their teacher when the migration runs.

**Data model.** `Program` (`id`, `name`, `adminId`, `subject` = `SAT`, `targets Int[]`, `aiDailyCapCents`, `createdAt`); `Class.programId`.

**Roles.** The program admin, plus the site admin for recovery.

**Tests.** Only the admin can transfer; the new admin gets full access at once and the old admin loses admin-only actions on their next request; the transfer writes an audit row; nobody else can see another program's classes.

### F1. Specialists and staff roles

**What it does.** Staff are added **per class**, the class standing in for "course" in your notes.

| Role | Access |
|---|---|
| **Program admin** | Everything in the program; the only one who adds or removes staff, unless they grant a teacher "Can manage staff" |
| **Teacher** | Full access to the class and all its groups |
| **Specialist** | Teaches and grades only inside the **scope** the admin assigns: SAT sections (Math, Reading and Writing), domains (for example only Advanced Math), and/or groups. Student tutors are added as specialists scoped to the group of students they tutor (decided: they can view, coach and grade) |
| **Viewer** | Read-only reports, for observers like a counselor or another teacher. Can't grade, assign, message or change anything |
| **Student** | Their own work only |

*Adding and managing staff:*

- The admin adds someone to a class **by email address**, picking the role and (for a specialist) the scope.
  - **The email has an account:** they get access right away and an email notification.
  - **No account yet:** they get an invite link that signs them up and lands them in the class.
- **Pending invites expire** after a set time (7 days by default; a program setting). The admin can resend (which gives a fresh link and a new expiry) or cancel them.
- The admin can **change a person's role or scope, or remove them**, at any time. **Removal takes effect immediately:** access is checked against the database on every request, so nothing is cached in their session.
- **Staff page per class:** everyone's name, role, scope, last login, and pending invites.
- **Audit log:** every role, scope, staff, invite and admin-transfer change records who changed what and when, with before and after. It has no edit or delete path. The admin sees it on the Staff page.
- **AI grade review:** teachers and specialists see a **"Review AI grades"** list of written answers Claude graded, for the groups and subjects in their scope. They can confirm or override each one. Overrides are recorded and recalculate the student's score.

*Scope enforcement (on the server):*

- One helper, `classAccess(user, classId)`, works out the caller's role and scope. Every class, report, grading, export and student page uses it, and filters rows by it in the database query, not in the UI.
- A specialist assigned to Math can't list, open, grade or export Reading and Writing assignments, answers or skill reports.
- A specialist scoped to a group can't see students outside it.
- Anything out of scope returns "not found", so ids can't be probed.

**Data model.**

- `ClassStaff`: `classId`, `userId`, `role` (`TEACHER | SPECIALIST | VIEWER`), `sections String[]`, `domains String[]`, `groupIds String[]`, `canManageStaff Boolean`, `addedById`, `createdAt`.
- `StaffInvite`: `classId`, `email`, role and scope, `tokenHash`, `expiresAt`, `invitedById`, `acceptedAt`, `cancelledAt`.
- `AuditLog`: `programId`, `actorId`, `action`, `targetType`, `targetId`, `before Json`, `after Json`, `createdAt`.
- `Assignment.section` and `Assignment.domains` (which subject an assignment covers, so scope can filter it).
- `Class.teacherId` stays as the creator; every class gets a `ClassStaff(TEACHER)` row for them.
- `User.lastLoginAt`, for the Staff page.

**Roles.** The program admin, and teachers granted "Can manage staff", manage staff. Other staff can see who else is on the Staff page.

**Tests.** A table-driven suite, every role × action: list students, view a student, view an assignment (Math and R&W), view its report, grade or override, assign, export, manage staff, transfer admin. Specific cases:

- A Math specialist can't see or grade R&W work, and a group-scoped specialist can't see students outside the group.
- A viewer can read reports but can't change anything.
- Removing a staff member blocks their very next request.
- Expired, cancelled and already-used invites fail; resending makes the old link stop working.
- Every change writes exactly one audit row.
- Only the admin (or a granted teacher) can add or remove staff.
- Staff of one program can't reach another program's classes.

### F2. SAT domains and skills

**What it does.** Tags every question, assignment and report with the official digital SAT structure:

- **Math:** Algebra · Advanced Math · Problem-Solving and Data Analysis · Geometry and Trigonometry
- **Reading and Writing:** Information and Ideas · Craft and Structure · Expression of Ideas · Standard English Conventions

Each domain has skills (for example "Linear equations in two variables"). The skill list is maintained by the admin. It starts from the public domain and skill outline (names only, no content). Reports roll up by section, then domain, then skill.

- **Tagging:**
  - When a worksheet is read or a question is drafted, a model suggests the domain and skill. A worksheet already passes through Claude, so its tags are suggested in the same call; questions entered by hand are tagged by Haiku.
  - Staff confirm the tags in the review screen. Untagged questions can't be used in diagnostics.
- **Difficulty:** each question has a difficulty (`EASY | MEDIUM | HARD`) for adaptive modules. It's suggested by the model, confirmed by staff, and later recalculated from real answer rates.

**Data model.**

- `SatDomain` (seeded, 8 rows) and `SatSkill` (`domainId`, name, order).
- On `WorksheetItem`, `Question` and the bank question (F3):
  - `section` (`MATH | RW`)
  - `domainId`
  - `skillId`
  - `difficulty`
  - `desmosSolvable` (see P3)
  - `tagStatus` (`SUGGESTED | CONFIRMED`)

**Roles.** Admin edits the skill list. Teachers and specialists (within scope) confirm tags. Students see domain names in their reports.

**Tests:**
- Tags round-trip through worksheet reading.
- A specialist can only confirm tags in their domains.
- Reports group correctly.
- Unconfirmed questions are rejected from diagnostics.

### F3. Question bank and versioning

**What it does.**

- **One bank** of original or licensed questions per program. Worksheet questions, drafted questions and diagnostic questions all live there, each with tags, difficulty, source and licence notes.
- **Versioning:** editing a question creates a new version. Past answers keep pointing at the version they answered, so editing never changes past grades. Re-grading against a new version is an explicit staff action, recorded in the audit log.
- **Search and filter** by section, domain, skill, difficulty, source and "never used".

**Data model.**

- `BankQuestion`:
  - `id`, `programId`, `currentVersionId`, `createdById`
  - `source`: `WORKSHEET | STAFF | AI_DRAFT | LICENSED`
  - `licenseNote`, `archivedAt`
- `BankQuestionVersion`:
  - `questionId`, `version`
  - content fields: `prompt`, `choices`, `answer`, `explanation`, `type`, `gridInAnswers` (for SAT student-produced responses)
  - tags
  - `reviewStatus`: `DRAFT | APPROVED`
  - `approvedById`, `createdAt`
- Answers (`AssignmentAnswer`, diagnostic answers) store `versionId`.
- Today's `WorksheetItem` migrates into the bank as version 1.

**Roles.** Teachers and specialists (in scope) create and edit. Only `APPROVED` versions can be assigned. Viewers read. Students never see unapproved versions, or any answer key before answering.

**Tests:**
- Editing keeps old grades.
- A draft can't be assigned.
- An out-of-scope specialist can't edit.
- Grid-in grading accepts equivalent forms (`3/4`, `.75`, `0.75`) and rejects others.

### F4. Security baseline

Covers part of the "Reliability, security and support" request.

**What it does:**

- **Two-factor login (TOTP authenticator app)**, required for the admin and all staff roles; optional for students. It uses the auth library's two-factor plugin, with backup codes and an admin-assisted reset path that's recorded in the audit log.
- **Audit log** (from F1).
- **Rate limits extended:**
  - **Already limited:** login, sign-up, answers, uploads, and AI per-user allowances.
  - **New limits:** invites, bulk messages, assistant questions, draft generation, and a program-wide daily AI spend cap. Once the cap is reached, AI features pause and the admin is emailed.

**Data model.** Two-factor tables from the auth plugin; a `ProgramSettings.aiDailyCapUsd` setting.

**Roles.** Two-factor is enforced for staff at login. The admin can reset another user's two-factor.

**Tests:**
- Staff without two-factor are sent to set it up and can't reach any data before then.
- Each rate limit trips.
- The spend cap blocks AI calls and alerts the admin.

---

## 3. Score tracking

### S1. Baseline score at signup (required)

**What it does.**

- When a student signs up (or accepts a class invite), they must enter a baseline: the source (**our diagnostic**, **PSAT**, **SAT**, or **practice test**), the date, the total, and the two section scores if known.
- If they have no score, they choose **"Take the diagnostic"**. They can use the site, but a banner and their teacher's dashboard show "Baseline missing" until the diagnostic is done.
- Staff can edit or verify a baseline. Edits are recorded in the audit log.

**Data model.** `ScoreRecord`:

- `studentId`
- `source`: `DIAGNOSTIC | PSAT | SAT | PRACTICE_BLUEBOOK | PRACTICE_OTHER`
- `takenOn`, `total`, `rw`, `math`
- `isBaseline`
- `enteredById`, `verifiedById`
- `missed Json?` (see S2)
- `createdAt`

**Roles:**
- **Students:** enter their own scores and edit unverified ones.
- **Teachers:** see and verify all records.
- **Specialists:** see only their scoped section scores (a Math specialist sees total and Math, not R&W domain detail).
- **Viewers:** read only.

**Tests:**
- A baseline is required (or "diagnostic pending" is set).
- Section scores add up (range checks: total 400–1600 and sections 200–800, in steps of 10).
- Students can't edit verified records.
- Scope rules apply.

### S2. Outside practice test entry (for example Bluebook)

**What it does.**

- A form for the date, test name (free text, for example "Bluebook Practice Test 4"), total, section scores, and **missed questions by number**, each with a domain and (optionally) skill and reason: careless, concept, time, or guess.
- No question text, ever: the form has no field for it.
- Missed items feed the mistake log as **external misses** (domain and skill practice, not the original question) and the domain report.

**Data model.** `ScoreRecord.missed: [{ section, module, number, domainId, skillId?, reason? }]`.

**Roles:** students enter their own; teachers can enter for a student; scopes as in S1.

**Tests:**
- No content fields are accepted (the server rejects unknown keys).
- Misses appear in the domain report.
- Another student's record can't be written.

### S3. Score history per student

A chart of official tests, practice tests and diagnostics over time, with markers for each source, the 1200 and 1300 target lines, and the projected score (S5). A table view sits beside it for screen readers. The data comes from `ScoreRecord`, so there's no new model.

**Roles:** the student; their teachers; specialists (with scoped detail); viewers.

**Tests:** points are ordered by date; sources are labelled; out-of-scope staff can't open another student's chart.

### S4. Program dashboard

**What it does.** For the admin and teachers (per class or program-wide):

- average gain over baseline (mean and median), and the number of students with two or more scores
- **on track** count: projected (S5) ≥ baseline + 300, or ≥ their target
- distance to the 1200 and 1300 targets, and a distribution of current scores
- the gain trend by month
- domain weaknesses across the cohort

Filters: class, group, and teacher.

**Data model:** none new (it reads ScoreRecord, projections and answers); add `StudentProfile.targetScore` (default 1200).

**Roles:**
- **Admin:** the whole program.
- **Teachers:** their classes.
- **Specialists:** their scope.
- **Viewers:** read only.
- **Students:** don't see the dashboard; they see their own progress only.

**Tests:**
- Aggregates are checked on fixtures.
- A teacher can't see another teacher's class unless granted.
- With small groups (under 5), viewers see aggregates only, not individuals, so no one can be identified.

### S5. Projected score and stalling flags

**What it does.** Estimates a current score range from recent work, so stalling students can be flagged:

- **Method:** the latest diagnostic or practice score, adjusted by domain accuracy since then (weighted toward the last 3 weeks).
- **Shown as a range** (for example 1150–1210) and labelled **"estimate"**.
- **Stalling:** no gain over the last 3 entries, or a projection that's dropped 30 points or more in 3 weeks.

⚠ **Risky:** this isn't an official conversion. It's tuned on our own data as it grows. Students see it (decided), so it's always shown as a range, labelled "estimate", with a one-line explanation of how it's worked out.

**Data model.** A nightly `ScoreProjection` table: `studentId`, `computedAt`, `low`, `high`, `basis`.

**Roles:** staff in scope; each student sees their own range (never anyone else's).

**Tests:**
- The calculation is deterministic on fixtures.
- Stalling is flagged in both directions (no gain, or a drop).
- A student sees only their own projection, always labelled as an estimate.

---

### S6. Official College Board practice (link-out only)

**What it does.**

- When making an assignment, a tutor can attach **College Board Student Question Bank questions by link and question ID** (for example `a1b2c3d4`), each with its section and domain.
- Students open each question **on the College Board site** (a new tab), then come back and record their result: correct, incorrect or skipped, an optional reason, and optionally the time taken.
- These results count toward the assignment's progress, domain reports and the mistake log (an incorrect one comes back as "retry question `a1b2c3d4` on College Board" until it's marked correct).
- **No question content is copied or stored:** there are no fields for question text, choices or answers, and the server rejects unknown fields. Links must point at the College Board's own site.

**Data model.** `Assignment.externalItems Json` (`[{ id, questionId, url, section, domain }]`); `ExternalResult` (`assignmentId`, `userId`, `itemKey`, `result`, `reason?`, `timeSec?`, `createdAt`).

**Roles.** Teachers, and specialists within their scope, attach links. Students record their own results. Staff see results in scope.

**Tests.** Only College Board links are accepted; content fields are rejected; a student can't record results for someone else or for an assignment they aren't given; an out-of-scope specialist can't see the results.

---

## 4. SAT-specific practice

### P1. Adaptive SAT-style diagnostics

**What it does.**

- **Building a diagnostic:**
  - Staff build one from bank questions (approved and tagged): per section, **Module 1** (mixed difficulty) plus a **harder Module 2** and an **easier Module 2**, each timed.
  - The defaults mirror the digital SAT's shape: number of questions and minutes per module, both editable.
  - The app checks domain coverage before a diagnostic can be published.
- **Assigning:** to a class, a group or chosen students, with a window (opens and closes).
- **Taking it:**
  - The timers run **on the server**.
  - Module 2 is chosen when Module 1 is submitted (at or above a set threshold of correct answers, the harder one). The student can't go back to Module 1.
  - One attempt per student unless a teacher allows a retake (recorded in the audit log).
  - Answers autosave.
  - If the connection drops, the student resumes with the remaining time.
- **Results:**
  - section scores as an **estimated** 200–800 range, from our own conversion table per diagnostic, which you can edit
  - domain and skill accuracy
  - time per question
  - The diagnostic counts as a `ScoreRecord(DIAGNOSTIC)` and sets the baseline if none exists.

⚠ **Risky:** scaled scores are estimates. The real SAT uses item response theory with calibrated items. The app says "estimated" everywhere and never "official".

**Data model:**

- `Diagnostic`: `programId`, `title`, `createdById`, `status` (`DRAFT | PUBLISHED`), `conversion Json`.
- `DiagnosticModule`:
  - `diagnosticId`
  - `section`
  - `stage`: `M1 | M2_HARD | M2_EASY`
  - `timeLimitSec`
  - `questionVersionIds[]`
  - `routeThreshold`
- `DiagnosticAssignment`: `classId`, `groupId?`, `studentIds[]`, `opensAt`, `closesAt`, `allowRetake`.
- `DiagnosticAttempt`: `studentId`, `diagnosticAssignmentId`, `attemptNo`, `startedAt`, `currentModule`, `moduleStartedAt`, `submittedAt`.
- `DiagnosticAnswer`: `attemptId`, `moduleId`, `versionId`, `choice`/`response`, `correct`, `timeMs`, `usedDesmos`.

**Roles:**
- **Teachers:** build, assign, and allow retakes.
- **Specialists:** build and see results for their sections only.
- **Students:** take it and see their results (scaled estimate plus domains), and the answer explanations after the window closes.

**Tests:**
- Routing goes to the harder and easier module correctly.
- Server time enforcement: late answers are rejected, and a page reload doesn't reset time.
- Each module can be submitted only once.
- A second attempt is rejected without retake permission.
- Scoring is checked against the conversion fixture.
- A Math specialist can't open R&W results.
- Answers aren't visible to students before the window closes.

### P2. Mistake log (review queue)

**What it does.**

- Every wrong answer goes into the student's queue: worksheets, diagnostics (after the window closes), course practice, and external misses (S2, as skill practice).
- Queue items come back on a spacing schedule (1, 3, 7, 16 days) until answered correctly **twice in a row**, then retire.
- External misses resurface as a similar bank question from the same skill (a different, approved question).
- Students can tag the reason they missed it.
- Teachers see each student's open-mistake count by domain.

The Error log and question spacing from Phase 12 already do this for course questions; P2 extends them to every source.

**Data model.** `MistakeItem`:

- `studentId`
- `sourceType`, `sourceId`, `versionId?`
- `skillId`
- `reason?`
- `due`, `streak`
- `retiredAt`

**Roles:** students see and answer their own items; staff in scope see the counts and the list.

**Tests:**
- An item is added on a wrong answer.
- It resurfaces on schedule.
- It retires after two correct answers in a row.
- External misses pick an approved question from the same skill.
- One student can't see another's queue.

### P3. Desmos

**What it does:**

- Math questions are tagged `desmosSolvable`: the model suggests it, staff confirm.
- An embedded Desmos graphing calculator is available on Math questions in practice and diagnostics, as on the real test.
- The app records whether the calculator was opened and used on each question.
- Reports show accuracy with and without Desmos on Desmos-solvable questions, which finds students who should use it more.

✅ **Decided:** use the embedded Desmos calculator. It needs a free API key and acceptance of Desmos's terms. ⚠ Those terms may treat a paid product differently from an in-house school tool, so re-check them before Coursebook is sold (see §13).

- **Fallback** if the key is ever unavailable: a link to desmos.com/calculator in a side panel, which can track "opened" but not "used".

**Data model.** `desmosSolvable` on question versions; `usedDesmos` and `desmosOpened` on answers.

**Roles:** staff confirm tags; students use the calculator.

**Tests:** usage is recorded per answer; the report splits correctly; the calculator isn't shown on R&W questions.

### P4. Test date and pacing plan

**What it does:**

- Students choose their SAT date from a list of official dates (entered by the admin) or enter one.
- The site builds a plan **backward from the test date**:
  - diagnostic checkpoints (for example every 4 weeks)
  - weekly domain focus from weakest to strongest
  - a final review week
  - assignments from their classes placed in the timeline
- It re-plans weekly from new results.
- This extends the existing study-plan feature.

**Data model.**

- `StudentProfile.testDate`
- `PacingPlan`: `studentId`, `generatedAt`, `weeks Json`.
- `ProgramSettings.officialTestDates[]`.

**Roles:** students set their own date; teachers can view and adjust their students' plans.

**Tests:**
- The plan always ends on the test date.
- A date in the past is rejected.
- Re-planning keeps completed weeks.
- A teacher outside the student's classes can't view the plan.

---

## 5. Running a large cohort

### C1. Groups within a class

**What it does:**

- Teachers create groups (for example "Math 1000–1100", "Weak: Advanced Math", "Tuesday session").
- Students can be in several groups.
- **Suggested groups:** by score band from the latest score, and by weakest domain. Staff accept or edit them.
- Groups are also the unit of **scope** for specialists (F1).

**Data model.** `ClassGroup` (`classId`, `name`, `kind`: `MANUAL | SCORE_BAND | WEAK_DOMAIN`) and `ClassGroupMember`.

**Roles:**
- **Teachers:** manage groups.
- **Specialists and tutors:** see groups in their scope.
- **Students:** don't see group names unless a teacher marks a group visible (so a "weak" label isn't shown to students).

**Tests:** membership changes; suggestions are computed correctly; specialists see only their groups; students can't see hidden group names.

### C2. Assign to a group or chosen students

**What it does.** Every assignment (lessons, questions, diagnostic) targets the whole class, one or more groups, or chosen students. Students who join a group later get that group's open assignments.

**Data model.** On `Assignment` (and `DiagnosticAssignment`): `groupIds String[]` and `studentIds String[]` (both empty means the whole class).

**Roles:** teachers, plus specialists within their scope.

**Tests:**
- Visibility for each targeting mode.
- A late joiner to a group gets its open work.
- A specialist can't target students outside their scope.

### C3. Attendance

**What it does:**

- Teachers create **sessions** (date, time, class, group), one by one or recurring.
- They take attendance on a phone: present, late, absent, or excused.
- A view compares each student's attendance rate with their score gain. This is a scatter chart with a table version, and it says clearly that the relationship isn't necessarily cause and effect.
- Absences feed alerts (C5).

**Data model.**
- `Session`: `classId`, `groupId?`, `startsAt`, `endsAt`, `createdById`.
- `AttendanceRecord`: `sessionId`, `studentId`, `status`, `markedById`, `markedAt`.

**Roles:**
- **Teachers and student tutors:** take attendance for their sessions.
- **Viewers:** read.
- **Students:** see their own attendance.

**Tests:** only the session's staff can mark it; editing a record is recorded in the audit log; the gain-vs-attendance numbers are checked on fixtures.

### C4. Bulk actions

**What it does:**

- **CSV roster import:** name, email, group, target score, optional baseline. There's a preview with row-by-row errors before anything is created, then invites are sent.
- **Bulk assign:** to several classes or groups at once (assigning to several classes already exists for worksheets).
- **Bulk message:** in-app plus email to selected students (and optionally guardians; see C6), with a template and merge fields for the student's name and what's due.
- **Grade export:** CSV of students × assignments with scores, and score history, per class or for the whole program. No emails in the export unless the admin ticks "include contact details".

**Data model.**
- `Message`: `senderId`, `classId`, `subject`, `body`, `sentAt`.
- `MessageRecipient`: `messageId`, `userId`, `readAt`, `emailStatus`.

**Roles:**
- **Teachers:** all four actions.
- **Specialists:** export and message within their scope.
- **Tutors:** message their own students only.
- **Viewers:** export aggregates only.

**Tests:**
- The CSV parser handles quoting and BOM, rejects duplicates, and never sends anything on validation errors.
- Exports respect scope.
- Message rate limits apply.
- A tutor can't message students outside their list.

### C5. Alerts

**What it does.** A nightly job creates alerts:

- **missing work:** past due and not done
- **dropping scores:** S5 stalling
- **inactive:** no activity for N days, configurable
- **absences:** 2 or more in a row

Staff see them in an Alerts inbox (only alerts in their scope), can dismiss or snooze them, and can opt into a daily digest email.

**Data model.** `Alert`: `classId`, `studentId`, `kind`, `details Json`, `createdAt`, `dismissedById`, `snoozedUntil`.

**Roles:** staff in scope.

**Tests:** each rule fires on fixtures and doesn't fire on the opposite case; alerts are scoped; the digest is opt-in.

### C6. Weekly email to parents or guardians (optional)

**What it does:**

- Teachers or students add guardian contacts, with **consent recorded**.
- Each week, an email sends a summary: work done or missing, attendance, the latest score, and one focus area. The wording is fixed and data-driven; there's no AI in the email itself.
- Guardians can unsubscribe with one click.
- Off by default; each class turns it on.

⚠ **Unclear:** check with the school whether guardians must opt in, and who may contact them.

**Data model.** `GuardianContact`: `studentId`, `name`, `email`, `relationship`, `consentAt`, `consentBy`, `unsubscribedAt`.

**Roles:**
- **Teachers:** manage contacts and the setting.
- **Students:** see who receives their summary and can request changes, depending on your decision about students 18 and older.

**Tests:** no email without consent; unsubscribing stops the next send; the summary content is checked on a fixture; contacts aren't visible outside scope.

---

## 6. Curriculum and AI assistant

**Rule for every item here:** AI output is a **draft** in a **Review** queue. Nothing reaches students until a staff member approves it, and the approver is recorded. AI grades (written answers) can be overridden by staff at any time; overrides are recorded in the audit log and recalculate scores.

### A1. Curriculum import during setup

**What it does.**

- During staff onboarding (the first login as staff), or later from the class settings, the teacher pastes their curriculum, uploads a syllabus PDF, or picks the default 1600 Project template.
- **Sonnet** turns it into units: titles, SAT domains and skills, planned weeks, and linked courses and worksheets where they match.
- The teacher maps the units onto the **school calendar**, with term dates and no-session days entered by the admin (importable as an ICS file).
- The plan drives the pacing plan (P4), the "this week" view, and the assistant.

**Data model.**
- `Curriculum`: `classId`, `title`, `sourceText`, `createdById`, `status` (`DRAFT | ACTIVE`).
- `CurriculumUnit`: `curriculumId`, `order`, `title`, `domainIds[]`, `skillIds[]`, `startsOn`, `endsOn`, `linkedCourseIds[]`, `linkedWorksheetIds[]`, `notes`.
- `SchoolCalendar`: `programId`, `termStart`, `termEnd`, `closedDates[]`.

**Roles:**
- **Teachers:** import and edit.
- **Specialists:** edit units in their domains.
- **Viewers:** read.
- **Students:** see the published week-by-week plan, not drafts.

**Tests:**
- The import produces valid units on a sample syllabus (Claude is faked in tests).
- Dates never fall on closed days.
- Drafts aren't visible to students.

### A2. AI drafts lessons and practice sets from the curriculum

**What it does.** From a unit or skill:

- "Draft a 10-question practice set on Advanced Math: nonlinear functions, medium difficulty"
- or a short lesson

The drafts are **original questions** with answers, explanations, tags, difficulty and "Desmos-solvable", grounded in the teacher's own course material when it's linked. They land in the Review queue as bank `DRAFT` versions. The teacher edits and approves each item, or the set.

**Model:** Sonnet for questions. Haiku isn't used here, because wrong answer keys are costly.

**Data model:** bank question versions with `source = AI_DRAFT` and `reviewStatus = DRAFT`; `DraftRequest` for cost tracking.

**Roles:** teachers, plus specialists within their scope.

**Tests:**
- A draft can't be assigned until it's approved.
- The approver is recorded.
- A specialist can't draft outside their scope.
- The cost is recorded per request.

### A3. Weekly summary per group

**What it does.**

- Every Sunday night, as a batch at half price, the assistant writes a per-group summary: who improved, who's struggling (with evidence), and what to reteach this week, with one-click buttons to assign a suggested practice set or lessons.
- The input is aggregated numbers by student id. Names are re-attached after the AI call, so the model sees ids only.
- Visible to staff only.

**Model:** Sonnet via the Batch API.

**Data model:** `AssistantSummary`: `groupId`, `weekOf`, `content Json`, `model`, `costMicroUsd`, `approvedById?` (for if summaries are ever shared with students).

**Roles:** staff in scope.

**Tests:**
- No names or emails in the prompt (asserted on the request).
- Scope: a Math specialist's summary has no R&W data.
- Generated once per week per group.

### A4. Pacing suggestions

**What it does.**

- **Rule-based triggers:**
  - a group is behind the curriculum by 1 week or more
  - a domain is below 60% for 2 weeks
  - the cohort's projection gain is stalling
- These produce suggestions such as "Add a review week for Advanced Math" or "Move Geometry one week later". Haiku writes them in plain words.
- The teacher accepts one, which updates the curriculum dates, or dismisses it.

**Model:** Haiku for the wording only. The decisions are rules, so they're testable and cheap.

**Roles:** teachers; specialists for their domains.

**Tests:** each trigger fires on fixtures; accepting a suggestion moves the dates and writes an audit row; Claude is faked in tests.

### A5. Ask about class data

**What it does.**

- Staff ask questions like "Which students are weakest in Advanced Math?" or "Who missed 2+ sessions and dropped?"
- The assistant uses **tool calls to a fixed set of read-only query functions**, such as students by domain accuracy, missing work, or attendance. These are the same scoped functions the reports use, so it can never see beyond the asker's scope. It never runs raw SQL.
- Answers cite the numbers and link to the report.

**Model:** Haiku for routing simple lookups; Sonnet when it needs judgement. Capped per user per day.

**Data model:** `AssistantQuestion` (`userId`, `classId`, question, tool calls, answer, cost), kept 90 days.

**Roles:** staff, with answers limited to their scope.

**Tests:**
- A specialist's tool calls can't return out-of-scope rows, even if the question asks for them.
- Prompt-injection text in student-written answers isn't followed. Student text is passed as data and marked as data.
- The cost cap applies.

---

## 7. AI models and cost by feature

Defaults: the cheapest model that holds quality. Batch where nobody waits.

| Feature | Model | Why | Rough cost |
|---|---|---|---|
| Worksheet reading (exists) | Sonnet 5.5 | Questions and answer keys must be exact | ~$0.10–0.20 per 10-page worksheet |
| Tag suggestions (F2) | In the worksheet call; Haiku 5.5 for questions entered by hand | Simple classification | < $0.001 per question |
| Draft questions and lessons (A2) | Sonnet 5.5 (batch when not urgent) | A wrong key is costly | ~$0.05–0.15 per 10-question set |
| Weekly summaries (A3) | Sonnet 5.5, Batch API | Judgement; nobody waits | ~$0.02 per group per week |
| Pacing wording (A4) | Haiku 5.5 | Wording only | negligible |
| Ask about data (A5) | Haiku 5.5, Sonnet 5.5 when needed | Mostly lookups | ~$0.01–0.04 per question |
| Grading written answers (exists) | Opus 5.5, low effort (can switch to Sonnet) | Fairness; SAT is mostly multiple choice and grid-in, which are graded **locally for free** | ~$0.01–0.02 per answer |
| Curriculum import (A1) | Sonnet 5.5 | Once per class | ~$0.05 |

Every call is recorded with its model, tokens and cost (this already exists, see `npm run cost:breakdown`). A program-wide daily cap (F4) stops runaway spending.

---

## 8. Privacy (review before real students use the site)

**This is not legal advice. Please review it with the school's administration before launch.**

- **FERPA:** if the program is run by or for the school, student scores and work here are likely *education records*. Usually that means the school should authorize the tool, with an agreement covering use limits, no selling or sharing, deletion on request, and security. Ask the school who signs that.
- **COPPA** applies to children under 13. SAT prep students are almost always 14–18, so sign-up should ask for date of birth (or "I'm 13 or older") and block under-13s. Students under 18 may need guardian notice or consent per school policy; C6 records consent.
- **Data collected:** name, email, scores, answers, attendance, guardian contacts (optional), activity times, and AI usage. No official test content.
- **Access:** role and scope on every request (F1), two-factor for staff (F4), and the audit log.
- **Logging:** no names, emails, scores or answers in application logs or error reports; ids only. Report-a-problem strips form contents.
- **AI:** prompts send ids rather than names where possible (A3). The current Anthropic API terms say API data isn't used for training by default. Verify this, and the data-retention terms, before launch.
- **Retention:**
  - Students can export their data (R6).
  - The admin can fully delete a student (R6).
  - Inactive accounts are reviewed yearly.
  - Backups expire after 30 days, so deleted data leaves the backups within 30 days.
- **Staging** never holds real student data (R5).

---

## 9. Testing approach

- **Permission matrix:**
  - One table-driven test file per area: roles × scopes × actions → allowed or denied.
  - A shared fixture builds a program with an admin, 2 teachers, a Math specialist, an R&W specialist scoped to group B, a tutor with 3 students, a viewer, and students in 2 groups.
  - Every new server function gets a row. A meta-test fails if a function that touches student data is missing from the matrix.
- **Integration tests** for each feature, with Claude faked.
- **The browser journey** extends to each role's main path, with the accessibility checks in light and dark mode and screenshots (`E2E_SHOTS`).
- **Phone checks:** every new page at 390 px wide, with no sideways scrolling (the existing check, extended).

---

## 10. Reliability, security and support

| Item | Today | Phase 3 work |
|---|---|---|
| **R1** Mobile-friendly | Phone layout and drawer; every page checked at 390 px | Test-taking, attendance and score entry designed phone-first; larger touch targets in diagnostics |
| **R2** Two-factor for admin and staff | – | F4 |
| **R3** Rate limits on login, invites and AI | Login, sign-up, answers, uploads, invites (this phase); per-user AI allowance | F4: program daily cap, assistant and draft limits |
| **R4** Error monitoring | Logs only | Error alerts by email (for example Sentry's free tier, or a self-hosted alternative) with personal data scrubbing; uptime check on `/api/health` |
| **R5** Staging site | – | A second deployment from a `staging` branch, with its own database and fake data only, in demo mode or with a low-capped API key |
| **R6** Data export and deletion | Account deletion; course exports | Per-student export (JSON plus CSV of scores, answers, attendance) for the student or admin; admin "delete student", which removes all rows and files (backups age out in 30 days) and is recorded in the audit log |
| **R7** Report a problem | – | A footer button that sends the page path, time, browser and recent error ids (no form contents) to the admin's inbox and an admin list |
| **R8** First-login walkthroughs | – | Short dismissible tours: student (classes, assignments, mistake log, test date) and staff (class setup, assigning, reports, review queue) |
| **R9** Question versioning | – | F3 |
| **R10** Test integrity | Server-kept timer for timed sets | P1: one attempt unless a retake is allowed, module locking, server timing, autosave and resume |

**Tests:**
- Two-factor and rate limits (F4).
- Export completeness on a fixture.
- Deletion leaves no rows behind (checks every table with a student id).
- The report carries no form data.
- Walkthroughs show once.
- Staging refuses to start with a production database address.

---

## 11. D1. Deployment: from your Windows PC to a hosted site

**Recommendation for 15–30 students:** few moving parts, mostly free tiers. Prices change, so check each before signing up.

| Piece | Service | Why | Monthly cost |
|---|---|---|---|
| Web app + worker + Redis | **Railway** (one project, two services from the same GitHub repo, plus Redis) | One dashboard, deploys on every push; the worker needs a long-running server | ~$5–20 (usage-based) |
| Database | **Neon** Postgres (has pgvector) | Free tier fits 30 students; built-in point-in-time restore; free **branches** for staging | $0 (≈ $19 if outgrown) |
| Files (PDFs, images) | **Cloudflare R2** | 10 GB free, no download fees | $0 |
| Email (password reset, invites, digests) | **Resend** | Free tier covers a program this size; good deliverability | $0 |
| Domain and HTTPS | Any registrar (~$12/year); HTTPS is automatic on Railway | | ~$1 |
| Error alerts | Sentry free tier (or similar) | R4 | $0 |
| **Claude API** | Anthropic, with a **$50/month limit** set in the console | See below | ~$10–40 |
| **Total** | | | **≈ $20–80/month** |

This is a simpler version of what `DEPLOY.md` already describes: Railway hosts the web app too, instead of Vercel, so there's one fewer account. Vercel's free Hobby plan is for personal, non-commercial use, and Coursebook is meant to be sold later, so Railway is the better fit either way.

**AI usage estimate for 30 students.** SAT questions are multiple choice and grid-in, so grading them is free (local).

| Item | Cost |
|---|---|
| Reading worksheets (~40 a month) | ~$5 |
| Drafting practice sets (~30 a month) | ~$3 |
| Weekly summaries (4 groups) | < $1 |
| Assistant questions (~200 a month) | ~$5 |
| Generating course lessons from books, if used (~20 chapters a month) | ~$10 |
| Written-answer grading and the tutor | ~$5 |
| **Total** | **≈ $15–30 a month** |

The daily cap (F4) and per-student allowances keep this bounded.

**Daily backups:**

1. Neon's point-in-time restore (how far back depends on the plan).
2. **Plus our own nightly `pg_dump`**, run by the worker on a schedule, compressed and uploaded to a private R2 folder, keeping 30 days. This is independent of Neon. A restore-test script and a monthly reminder to run it go into `DEPLOY.md`.

**HTTPS:** automatic on Railway (and on a custom domain). The app already sends HSTS on HTTPS.

**Password reset:** already built; it needs the email service (Resend) configured. Without SMTP it fails loudly in production, as it should.

**Deploying updates (simple):**

1. Work on your PC as now.
2. Push to the `staging` branch: it deploys to the staging site (its own Neon branch with fake data) for you to try.
3. Merge to `main`: it deploys to the live site.

Database migrations run automatically on deploy (`prisma migrate deploy`). Rollback means redeploying the previous version in Railway's dashboard. I'll add a one-page "how to update the site" guide written for Windows.

**Moving off your PC (one time):**

1. Create the accounts above.
2. Set the environment variables. `DEPLOY.md` lists them all; I'll add a checklist for this setup.
3. Connect the GitHub repo in Railway.
4. Run `npm run admin:grant -- you@school.org` on the live site.
5. Leave the local data behind: it's test data. If you want to move it, a guide covers dumping from local Docker Postgres on Windows and restoring to Neon.
6. Invite staff, and then students.

**Before real students:** privacy review (§8), invite-only sign-up turned on, two-factor for staff, the legal pages filled in, and a restore test done once.

**I won't sign up for or configure any service** until you've chosen. The options, side by side:

| Need | Option A (recommended) | Option B | Option C |
|---|---|---|---|
| Web app + worker + Redis | Railway (~$5–20) | Render (~$7 per service + Redis; ~$20–30) | One small Linux server (Hetzner or DigitalOcean, ~$6–12) with docker-compose; cheapest, but you maintain it |
| Database | Neon (free; branches for staging) | Supabase (free tier pauses after a week idle) | Postgres on Railway (~$5) or on the same server |
| Email | Resend (free: 3,000 a month) | Brevo (free: 300 a day) | Your school or Gmail SMTP: free but strict sending limits |

**AI spending cap.** The program's daily cap (F4) stops AI features for the day once reached and emails the admin. You can also set a monthly limit in the Anthropic console.

**Staging copy.** A second deployment from the `staging` branch with its own database (a Neon branch) and **fake data only**. It refuses to start if its database address matches production's, and it uses demo mode or a separate low-capped API key. Push to `staging`, try it, then merge to `main` to go live.

**Your program's data stays in its own setup.** The 1600 Project runs on **its own deployment and database**, owned by you. A future commercial version of Coursebook would be a separate deployment with its own database, accounts and keys, so no 1600 Project student data is ever in it. The program model (F0) also keeps programs apart inside any one deployment.

### 11.1 Documentation and handoff (H1, H2)

- **H1. Admin guide (`ADMIN_GUIDE.md`, linked from the admin pages).** Plain steps, written for a teacher or younger student who takes over after you graduate:
  - how to deploy an update (and roll it back)
  - how backups work, and how to restore one (with a practice run)
  - adding, changing and removing staff
  - transferring the admin role
  - starting a new semester: archiving classes, new join codes, carrying over students and question banks
  - what to do when an error alert arrives
  - where the passwords and keys live, and handing them over
- **H2. Privacy-review note (`PRIVACY_REVIEW.md`).** A checklist to go through with your school before real students use the site: FERPA, COPPA (students under 13), parental consent for students under 18, the privacy policy and terms of use pages (the site has templates to fill in), and what data is collected and where it's stored. Not legal advice.

**Tests.** The guide's commands are the real script names (a test checks each one exists in `package.json`).

---

## 12. Open questions and risks

**Decided (10 Nov 2026):**
- Specialists and staff attach to a **class**, scoped by groups and domains.
- Student tutors **can grade, view and coach** their assigned students, and see their scores.
- Students **see their own estimated and projected scores** (always labelled as estimates).
- **Desmos:** use the embedded calculator.
- Coursebook runs **in-house for The 1600 Project first, then becomes a paid product** (see §13).

**Still open:**

1. **Students 18 and older:** do guardians still get summaries if the student opts out?
2. **Baseline required:** OK that a student without a score can use the site, with "Baseline missing" shown until they take the diagnostic?
3. **Question source:** do you have licensed question sets to import, or will the bank start from staff worksheets and reviewed AI drafts?
4. **School agreement** for FERPA: who at the school should approve (§8)?
5. **Hosting accounts:** whose name and card? The staging site needs its own (low-capped) API key.

---

## 13. In-house first, paid product later

Coursebook starts as The 1600 Project's own tool and is meant to be sold later. That doesn't add features to Phase 3, but it changes a few design choices now, so they don't need redoing later:

- **Every Phase 3 table belongs to a program** (`programId`), and nothing is hard-coded to The 1600 Project: its name, targets (1200 and 1300), test dates and calendar are program settings. A second school later is a new program, and its data stays separate.
- **Scope checks go through one helper** (F1), which also checks the program, so one school can never see another's data.
- **Content rights matter more once you charge:** the no-official-content rule, the rights checkbox on uploads, and the `source` and `licenseNote` on every bank question (F3) are what you'd show a school or a publisher if asked.
- **AI costs are already recorded per user and feature,** which is what pricing will need later.

⚠ **Before charging anyone (not part of Phase 3):**
- **Terms to re-check for commercial use:** Desmos API, Anthropic, and the free tiers in §11.
- **Selling to schools:** they'll usually ask for a signed data-privacy agreement, and some US states have student-privacy laws for paid ed-tech (for example California's SOPIPA). Plan a legal review.
- **Paid-product features:** billing, a terms of service and privacy policy written for schools, and support.
- **Separate the 1600 Project's data:** keep it in its own program, and get its approval before using its numbers (for example average gains) in marketing.

---

## 14. Suggested additions (approve or cut each one)

These aren't in the main list. Each is independent unless noted.

1. **Accommodations:** extended time per student (1.5×, 2×) applied automatically to timed sets and diagnostics. Needed for fairness; small change (P1).
2. **Time-per-question coaching:** flag questions where a student is much slower than the class, and pacing drills ("finish 10 questions in 12 minutes"). Builds on P1 timing data.
3. **Self-reflection after each practice test:** students tag each miss as careless, concept, timing or misread. Reports show which kind dominates, which changes what to teach.
4. **Session notes:** short notes on what was covered and next steps per tutoring session or student, visible to staff (and to the student if marked). Pairs with C3.
5. **Student goals and milestones:** each student sets a target (1200 or 1300) and sees milestone badges at +50, +100… points. Motivation without public leaderboards.
6. **Opt-in class leaderboard by effort (not score):** questions answered and streaks. Teachers can turn it off.
7. **Printable PDFs of assignments** for offline sessions, with an answer-entry form back in the app.
8. **Grant and funder reports:** a one-click anonymized program summary (average gain, attendance, completion) for school leadership or funders. No names.
9. **Low-bandwidth mode:** lighter pages and no animations, for students on weak phone data.
10. **Reading passage tools:** highlight and annotate in R&W passages, as on the digital test.
11. **Calendar sync:** sessions and due dates as a subscribable calendar link (ICS) for Google or Apple Calendar.
12. **Student tutor onboarding checklist:** training items a tutor must complete (privacy basics, how to give feedback) before they see student data.
13. **"Explain my mistake" for students:** after the window closes, a short AI explanation of a missed question's trap. Haiku, staff-approved per question first (fits the review-before-publish rule).
14. **Duplicate and quality checks for the bank:** warn when a new question is near-identical to an existing one, or when an answer key looks inconsistent with the explanation. Haiku, cheap.
