import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Help and FAQ" };

type QA = { q: string; a: React.ReactNode };

const GENERAL: QA[] = [
  { q: "What is Coursebook?", a: "Coursebook turns a textbook or slide deck you upload into a course: lessons, flashcards and quizzes. Tutoring programs also use it to run their classes, scores, diagnostics and messages." },
  { q: "What's a program?", a: "A tutoring program (for example, a school's SAT program) that runs its classes on Coursebook. You join one through your tutor's invite link or class code. If you're not in one, you can still make your own courses." },
];

const STUDENT: QA[] = [
  { q: "How do I join a live warm-up?", a: <>When your tutor starts one, a <strong>Live now</strong> button shows on Today. Or open <strong>Join live</strong> in the menu and type the six-character code. Answer each question once; the answer and explanation appear when your tutor reveals them.</> },
  { q: "How do I book office hours?", a: <>Open <strong>Office hours</strong> in the menu, choose a tutor and pick an open time (add a note about what you&apos;d like help with). You&apos;ll get a confirmation and a reminder the day before, and it&apos;s on your calendar. You can cancel or move it until it starts.</> },
  { q: "A question looks wrong. What do I do?", a: <>Press <strong>Report this question</strong> under it (in practice sets and assigned questions), pick what&apos;s wrong and add a note if you like. Whoever wrote it gets a notice. Your name isn&apos;t shown to them.</> },
  { q: "Who is my tutor?", a: <>If your program gave you a primary tutor, Today shows their name. You can message them (and your other tutors) from <strong>Messages</strong>.</> },
  { q: "How do I join my class?", a: <>Open the invite link your tutor sent, or go to <strong>Classes</strong> and enter the class code. If you&apos;re new, sign up first; you come straight back to the class.</> },
  { q: "What's a baseline, and why does it matter?", a: <>It&apos;s your starting score: your latest PSAT, SAT or practice test. Your progress is measured from it. Add it under <strong>SAT scores</strong>. No score yet? Choose &quot;I&apos;ll take the diagnostic&quot;; its result becomes your baseline.</> },
  { q: "What's the 'estimated now' range?", a: "An estimate of where you are today, from your recent scores and practice. It isn't an official SAT score; it's there to show your direction." },
  { q: "How do diagnostics work?", a: "They're timed like the digital SAT: in each section, how you do on module 1 decides whether module 2 is harder or easier. The clock keeps running if you close the page, so start when you have the full time. You get one attempt unless your tutor allows another." },
  { q: "How do I add my College Board results?", a: <>On <strong>SAT scores</strong> → Add a score: enter the totals, then (optional) the <strong>Knowledge and Skills</strong> bands from your score report (each content area shows 1 to 7 boxes). For a Bluebook practice test, open its question review in College Board&apos;s My Practice, copy the table and paste it in: the site reads each question&apos;s area, skill and whether you got it right (never the question itself). Your misses go into your mistake log, and <strong>Where to focus</strong> shows your weakest areas.</> },
  { q: "What's the mistake log?", a: <>Every question you miss comes back after 1, 3, 7 and 16 days until you&apos;ve got it right twice in a row. Questions from outside tests come back as similar practice. Open <strong>Mistake log</strong> for a few minutes most days.</> },
  { q: "Where do College Board questions come from?", a: "Your tutor links to questions on College Board's own Question Bank. You answer them there, then come back and say how it went. We never copy official questions." },
  { q: "Can I use Desmos?", a: "Yes. Math questions have a Desmos button, like on the real test." },
  { q: "Who can read my messages?", a: "You and the tutor you're writing to. Your program admin can also read conversations in your program, to keep everyone safe." },
  { q: "Can I send a photo or a PDF in a message?", a: <>Yes. In a conversation, press <strong>Attach a file</strong> under the reply box: PNG, JPG or PDF, up to 10 MB each (5 per message). Pictures show right in the conversation. Only you, the person you&apos;re writing to and your program admin can open them.</> },
  { q: "Who can see my scores and work?", a: "Your tutors for your class (some only for their subject or group) and your program admin. Other students never see your scores; there are no leaderboards." },
  { q: "How do I download or delete my data?", a: <><strong>SAT scores</strong> → &quot;Download all your tutoring records&quot;. To delete your account, go to <strong>Settings</strong> → Delete account.</> },
];

const STAFF: QA[] = [
  { q: "What can each role do?", a: "Teachers: everything in their class. Specialists: only the subjects and/or student groups they're given (student tutors are specialists limited to their group). Viewers: read-only reports. Your program admin runs the program and manages staff." },
  { q: "Why do I need two-factor login?", a: "Staff can see student data, so an authenticator-app code is required at login. Set it up under Settings → Two-factor login. Lost your phone? Use a backup code, or ask your program admin to reset it." },
  { q: "How do I assign work?", a: "A class's Assign tab: lessons from your courses, worksheet questions (upload a PDF under Worksheets first), College Board questions by link, and diagnostics. Each can go to the whole class, groups or chosen students." },
  { q: "Does anything AI-made go to students without me?", a: "No. Drafted questions and lessons wait in Teaching → Review queue until someone approves them, and you can confirm or override any grade Claude gives a written answer." },
  { q: "Can I import College Board results for the whole class?", a: <>Yes: class → Scores → <strong>Import College Board score reports</strong>. Upload a CSV from College Board&apos;s reporting portal or our template (email, test, date, total, section scores and each area&apos;s band 1–7). Press Check to see what will happen, then Add. Students are matched by email. Each student&apos;s page then shows their <strong>weak spots</strong>, and the class&apos;s Skills tab shows which areas are hardest for the most students.</> },
  { q: "How do I see who needs help?", a: <>Start with <strong>Teaching → Needs attention</strong>: one ranked list across all your classes (only students in your scope) of missed or late work, accuracy dropping over the last 2 weeks, no login or practice for a while, the same skill missed again and again, and score estimates below target pace. Each item has quick actions: message the student, assign a practice set, mark it handled, or snooze it. Handled and snoozed items come back if something new happens. Each class also has Scores, Skills, Alerts and Attendance, and the program admin has the program dashboard.</> },
  { q: "What's weekly practice?", a: <>Each week every student gets a proposed set of 8–12 published question-bank questions aimed at their weakest skills (no AI, so it works for every account). Open a class&apos;s <strong>Weekly practice</strong> tab to remove or swap questions, take a student out, then approve them all: each set becomes that student&apos;s own assignment.</> },
  { q: "How do I find students who need the same help?", a: <>A class&apos;s <strong>Small groups</strong> tab groups students by their weakest skill, with the group&apos;s size and accuracy. Message the group, assign a set for that skill, or create a session just for them. The program admin sees groups across all classes.</> },
  { q: "How do I run a live warm-up or exit ticket?", a: <>A class&apos;s <strong>Live</strong> tab: pick a short published set and start. Students join from Today or at <strong>/live</strong> with the code. You see how many answered, the percent correct and how many picked each choice as answers arrive. Students see answers only when you reveal them. Closing the run saves it to a session and marks who took part as present.</> },
  { q: "How do I assign a whole worksheet or set?", a: <>A class&apos;s <strong>Assign</strong> tab has a Worksheet card (every question on it, to the class, groups or students) and a Practice set card. To send a published set to several classes at once, open it in the question bank and use <strong>Assign to classes</strong>.</> },
  { q: "Can I reuse messages or send them later?", a: <>Yes. Save messages you send often under <strong>Messages → Saved replies</strong> (just for you, or shared with your program), then insert them when writing. <code>{"{first_name}"}</code>, <code>{"{class}"}</code> and <code>{"{due_date}"}</code> are filled in for each student. Tick <strong>Send later</strong> to schedule a message or announcement; edit or cancel it under <strong>Messages → Scheduled</strong> until it goes.</> },
  { q: "What does starting a new semester copy?", a: <>Program page → <strong>Start a new semester</strong> copies each class you tick with its staff, scopes and groups (empty) and a new join code. Tick <strong>Copy its courses and question sets</strong> to bring the class&apos;s courses and its lesson and practice-set assignments too, with no due dates: set new ones on the Assign tab.</> },
  { q: "How do office hours work for staff?", a: <>Teaching → <strong>Office hours</strong>: add weekly open times (slot length, gaps, a daily maximum, the dates they apply). Students who you teach book them. After each one, press Attended or No-show to record it as a 1:1 session with attendance.</> },
  { q: "Where do question reports and question stats show?", a: <>Teaching → <strong>Question reports</strong> lists reports on bank questions (for question authors) and on your worksheets, grouped by question: mark fixed, no change, or unpublish. On the bank, sort by answers, % correct, time, reports or flags, or show <strong>Likely bad only</strong>; each question&apos;s page shows how students did on its current version.</> },
  { q: "What's my caseload?", a: <>The students your program admin made you the <strong>primary tutor</strong> for. Tick &quot;My caseload only&quot; on Needs attention to see just them. A student&apos;s page shows their primary tutor, and students see theirs on Today.</> },
  { q: "Can I add official College Board questions?", a: <>Question authors can, from <strong>Question bank → College Board</strong>: upload a PDF, screenshots or pasted text, check the questions, then add them as drafts. Use them only to teach your own students; don&apos;t post them publicly.</> },
  { q: "Something's broken. What do I do?", a: <>Use <strong>Report a problem</strong> at the bottom of any page. It sends the page and recent error codes to the site admin, never what you&apos;ve typed.</> },
];

function Section({ id, title, items }: { id: string; title: string; items: QA[] }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      {items.map((x) => (
        <details key={x.q} className="group rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-semibold marker:text-accent-ink">{x.q}</summary>
          <div className="mt-2 text-sm leading-relaxed text-muted">{x.a}</div>
        </details>
      ))}
    </section>
  );
}

/** Help for students and staff. */
export default function HelpPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12">
      <div>
        <h1 className="font-display text-4xl font-semibold">Help and FAQ</h1>
        <p className="mt-2 text-muted">
          How {BRAND.name} works. Jump to <a href="#students" className="underline">students</a> or <a href="#staff" className="underline">tutors and staff</a>.
        </p>
      </div>
      <Section id="general" title="About Coursebook" items={GENERAL} />
      <Section id="students" title="For students" items={STUDENT} />
      <Section id="staff" title="For tutors and staff" items={STAFF} />
      <p className="text-sm text-muted">
        Still stuck? Ask your tutor, or use Report a problem at the bottom of the page. Policies: <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link>
      </p>
    </div>
  );
}
