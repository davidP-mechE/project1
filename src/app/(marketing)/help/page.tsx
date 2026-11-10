import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Help and FAQ" };

type QA = { q: string; a: React.ReactNode };

const STUDENT: QA[] = [
  { q: "How do I join my class?", a: <>Open the invite link your tutor sent, or go to <strong>Classes</strong> and enter the class code. If you&apos;re new, sign up first; you come straight back to the class.</> },
  { q: "What's a baseline, and why does it matter?", a: <>It&apos;s your starting score: your latest PSAT, SAT or practice test. Your progress is measured from it. Add it under <strong>SAT scores</strong>. No score yet? Choose &quot;I&apos;ll take the diagnostic&quot;; its result becomes your baseline.</> },
  { q: "What's the 'estimated now' range?", a: "An estimate of where you are today, from your recent scores and practice. It isn't an official SAT score; it's there to show your direction." },
  { q: "How do diagnostics work?", a: "They're timed like the digital SAT: in each section, how you do on module 1 decides whether module 2 is harder or easier. The clock keeps running if you close the page, so start when you have the full time. You get one attempt unless your tutor allows another." },
  { q: "What's the mistake log?", a: <>Every question you miss comes back after 1, 3, 7 and 16 days until you&apos;ve got it right twice in a row. Questions from outside tests come back as similar practice. Open <strong>Mistake log</strong> for a few minutes most days.</> },
  { q: "Where do College Board questions come from?", a: "Your tutor links to questions on College Board's own Question Bank. You answer them there, then come back and say how it went. We never copy official questions." },
  { q: "Can I use Desmos?", a: "Yes. Math questions have a Desmos button, like on the real test." },
  { q: "Who can see my scores and work?", a: "Your tutors for your class (some only for their subject or group) and the program admin. Other students never see your scores; there are no leaderboards." },
  { q: "How do I download or delete my data?", a: <><strong>SAT scores</strong> → &quot;Download all your tutoring records&quot;. To delete your account, go to <strong>Settings</strong> → Delete account.</> },
];

const STAFF: QA[] = [
  { q: "What can each role do?", a: "Teachers: everything in their class. Specialists: only the subjects and/or student groups they're given (student tutors are specialists limited to their group). Viewers: read-only reports. The program admin runs the program and manages staff." },
  { q: "Why do I need two-factor login?", a: "Staff can see student data, so an authenticator-app code is required at login. Set it up under Settings → Two-factor login. Lost your phone? Use a backup code, or ask the program admin to reset it." },
  { q: "How do I assign work?", a: "A class's Assign tab: lessons from your courses, worksheet questions (upload a PDF under Worksheets first), College Board questions by link, and diagnostics. Each can go to the whole class, groups or chosen students." },
  { q: "Does anything AI-made go to students without me?", a: "No. Drafted questions and lessons wait in Teaching → Review queue until someone approves them, and you can confirm or override any grade Claude gives a written answer." },
  { q: "How do I see who needs help?", a: "Each class has Scores (gain, on track, stalling), Skills (weakest skills), Alerts (overdue work, dropping scores, inactive, absences) and Attendance. The program admin also has the program dashboard." },
  { q: "Can I upload official SAT or Bluebook questions?", a: "No. The site refuses them; questions must be original or licensed. Link to College Board's Question Bank instead." },
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
          How {BRAND.name}&apos;s site works. Jump to <a href="#students" className="underline">students</a> or <a href="#staff" className="underline">tutors and staff</a>.
        </p>
      </div>
      <Section id="students" title="For students" items={STUDENT} />
      <Section id="staff" title="For tutors and staff" items={STAFF} />
      <p className="text-sm text-muted">
        Still stuck? Ask your tutor, or use Report a problem at the bottom of the page. Policies: <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link>
      </p>
    </div>
  );
}
