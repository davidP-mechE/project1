# Privacy review: before real students use the site

**This is a checklist for you to go through with your school's administration. It is not legal advice.** Laws and school policies vary by state and district; the school (and, if needed, its lawyer) decides what applies.

The 1600 Project is your own program, not run by the school. Even so, if it uses school email addresses, recruits through the school, or shares results with teachers or counselors, the school will likely want a say. Ask early.

## 1. Questions to answer with the school

| Topic | What to ask | Where it shows in the site |
|---|---|---|
| **FERPA** (US federal student-records law) | Does the school consider this program's records to be education records? If the school shares any student data with you (rosters, scores, emails), does it need a written agreement first, and who signs it? | Roster import; score entry; guardian emails |
| **COPPA** (children under 13) | Confirm all students are 13 or older. SAT prep students almost always are. If anyone could be under 13, parental consent is needed before they sign up. | Sign-up has no age check yet (see `KNOWN_ISSUES.md`) |
| **Parental consent** (students under 18) | Does the school require a parent or guardian's permission for students under 18 to join an outside program, or to receive emails? | Guardian contacts record *who agreed and when*; nothing is sent without it |
| **Privacy policy** | Draft one that matches what the site actually does (below), and have the school review it. | `/privacy` is a draft template |
| **Terms of use** | Who can use the site, acceptable use, what happens to accounts at the end of the program. | `/terms` is a draft template |
| **Data retention** | How long to keep data after a student leaves or graduates. Suggestion: delete a year after their last session. | Export and delete tools (ADMIN_GUIDE.md §9) |
| **Who can see what** | Do teachers, counselors (viewers) and student tutors seeing scores fit school policy? | Roles and scopes; the audit log |

## 2. What the site collects

| Data | From | Notes |
|---|---|---|
| **Account** (name, email, password, timezone) | The student | Passwords are hashed and never stored in plain text |
| **SAT scores** (totals, section scores, missed question numbers and topics) | Student or staff | No test content |
| **Answers** (to assignments, diagnostics, College Board questions by link), attendance, mistake log, goals and test date | Use of the site | |
| **Guardian contacts** (name, email, relationship) | Staff | Only with recorded consent |
| **Usage** | Use of the site | Activity times; AI usage and cost per feature |
| **Error reports** | The site | Page address, browser, error message with emails and long numbers removed. Never form contents |

**What it does not collect:**
- official College Board, SAT, PSAT or Bluebook questions (the site refuses them)
- payment details
- location
- advertising or tracking cookies

## 3. Where data goes

| Destination | What's sent | Status |
|---|---|---|
| **Your hosting and database providers** | Everything, stored on their servers | Choose providers whose terms you're comfortable with |
| **Anthropic (Claude)** | The text of written answers being graded, worksheet pages, syllabus text, questions asked to the assistant, and class numbers for weekly summaries (with stand-in labels instead of student names) | Anthropic's API terms say API data isn't used to train models by default. **Verify the current terms and their data-retention period** before launch |
| **Email provider** | Email addresses and the content of emails (invites, password resets, alerts, guardian summaries) | |
| **Desmos** | Nothing from Coursebook; the calculator runs in the student's browser | Only if a Desmos key is set |

## 4. Protections already in place

- **Role and scope checks** on every server request: a Math specialist can't see Reading and Writing work; a tutor sees only their group.
- **Two-factor login** is required for all staff.
- **Audit log** of staff, role, grade, export and deletion actions.
- **No student data in URLs** (only internal ids) and none in error logs.
- **Exports and deletion on request.** Backups expire after 30 days.
- **AI drafts need approval:** nothing Claude writes reaches students without a staff member's approval.
- **The staging copy refuses to run on the real database.**

## 5. Before launch: checklist

- [ ] The school has reviewed this document and said what agreement (if any) is needed.
- [ ] Privacy policy (`/privacy`) and terms of use (`/terms`) completed and reviewed.
- [ ] Age confirmed (13+) for every student; parental permission collected if the school requires it.
- [ ] Guardian emails: decide whether to turn them on, and collect consent.
- [ ] Anthropic API data terms checked and noted here (date checked: ______).
- [ ] Staff have two-factor login set up.
- [ ] One backup restore practised (`ADMIN_GUIDE.md` §5).
- [ ] A retention period decided (date decided: ______).
