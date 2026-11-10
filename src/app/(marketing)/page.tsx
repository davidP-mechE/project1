import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ScoreGauge } from "@/components/scores/score-gauge";
import { getSession } from "@/server/session";
import { BRAND } from "@/lib/brand";

const features = [
  { title: "Know where you stand", body: "Start with your PSAT, SAT or our adaptive diagnostic. Every practice test after that adds to your progress chart, with an honest estimate of where you are now." },
  { title: "Practise what you miss", body: "Every question you get wrong comes back in your mistake log until you've got it twice in a row: worksheets, diagnostics and College Board questions alike." },
  { title: "Tutors who see the whole picture", body: "Your tutors assign work for your weakest areas, see which skills need another pass, and plan the weeks to your test date with you." },
];

const steps = [
  ["Join your class", "Your tutor sends a link or a class code."],
  ["Set your baseline and goal", "Your latest score, the score you're aiming for, and your test date."],
  ["Work the plan", "Assignments, diagnostics and your mistake log, a little every day."],
  ["Watch the gain", "Every score adds to your chart. The goal: +300 points."],
];

/** The public front page: what The 1600 Project is and how the site helps. Logged-in people go straight to Today. */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-12 sm:py-16">
      <section className="hero-card grid items-center gap-8 rounded-[1.75rem] px-6 py-12 sm:px-12 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <p className="font-display text-sm font-semibold tracking-[0.2em] text-[#d9b84a]">{BRAND.name.toUpperCase()}</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">An SAT prep program built around one number: your gain.</h1>
          <p className="max-w-xl text-lg opacity-90">
            Our school&apos;s average SAT score is about 970. Our goal is a 300-point gain for every student, toward 1200 and 1300, with tutors, practice and a plan to get there.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup" className="hero-button">
              Join the program
            </ButtonLink>
            <ButtonLink href="/login" variant="ghost" className="hero-ghost">
              Log in
            </ButtonLink>
          </div>
        </div>
        <div className="rounded-2xl bg-surface p-4 text-text shadow-lg">
          <ScoreGauge score={1180} baseline={970} goal={1300} label="Example: a student's progress" caption="+210 since their PSAT, on the way to 1300." />
        </div>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-6">
        <h2 id="how" className="font-display text-3xl font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-border bg-surface p-5">
              <span className="score-num text-3xl text-accent-ink">{i + 1}</span>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="features" className="flex flex-col gap-6">
        <h2 id="features" className="font-display text-3xl font-semibold">
          What you get
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <li key={f.title} className="lift rounded-2xl border border-border bg-surface p-6">
              <span aria-hidden className="block h-1 w-10 rounded-full bg-accent" />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Tutor or teacher?</h2>
          <p className="text-sm text-muted">Staff get their own invite from the program admin. Questions about the program or the site are answered in Help.</p>
        </div>
        <ButtonLink href="/help" variant="secondary">
          Help and FAQ
        </ButtonLink>
      </section>
      <p className="text-center text-xs text-muted">
        {BRAND.name} isn&apos;t affiliated with College Board. SAT® is a trademark of College Board. Scores shown in the site from our own diagnostics are estimates. <Link href="/privacy" className="underline">Privacy</Link>
      </p>
    </div>
  );
}
