import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ScoreGauge } from "@/components/scores/score-gauge";
import { ProgramBadge } from "@/components/brand/seal";
import { getSession } from "@/server/session";
import { publicProgram } from "@/server/programs";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";
import { coverColor } from "@/lib/subjects";

const study = [
  { title: "Courses from your books", body: "Upload a textbook or a slide deck. Coursebook turns it into units, lessons, flashcards and quizzes, with page references back to the original." },
  { title: "Practice that remembers", body: "Spaced repetition for flashcards, a mistake log that brings back what you got wrong, and an AI tutor that answers from your own book." },
  { title: "Progress you can see", body: "Streaks, mastery by topic, and a plan that counts back from your test date." },
];

const programs = [
  { title: "Classes and staff roles", body: "Teachers, subject specialists limited to their groups, read-only viewers, and a program admin. Everyone sees exactly their part." },
  { title: "Scores and diagnostics", body: "Adaptive practice diagnostics, a score history for every student, and an honest estimate of where they are now." },
  { title: "Mistake log and assignments", body: "Assign lessons, worksheets and College Board links to a class, a group or chosen students. Every miss comes back until it's mastered." },
  { title: "Messages and announcements", body: "Tutors message the students in their scope; announcements reach a class or a group. Nothing is public, and there are no leaderboards." },
];

/** Three covers from the series, fanned out: what a library on Coursebook looks like. */
function CoverStack() {
  const covers = [
    { title: "Biology", subject: "biology", turn: "-rotate-6 translate-y-3" },
    { title: "Pre\u00adcalculus", subject: "physics", turn: "rotate-2 -translate-y-2" },
    { title: "Your slides", subject: "ela", turn: "rotate-[8deg] translate-y-5" },
  ];
  return (
    <div aria-hidden className="hidden items-end justify-center md:flex">
      {covers.map((c, i) => (
        <span
          key={c.title}
          className={`hero-card -ml-6 flex h-52 w-36 shrink-0 items-end rounded-md pb-6 pl-6 pr-3 shadow-[0_10px_0_-4px_rgb(0_0_0/0.25)] ring-2 ring-white [--band:0.45rem] [--spine:0.8rem] first:ml-0 ${c.turn}`}
          style={{ ["--cover" as string]: coverColor(c.subject), zIndex: i }}
        >
          <span className="cover-title text-lg">{c.title}</span>
        </span>
      ))}
    </div>
  );
}

/** The public front page: what Coursebook is. Logged-in people go straight to Today. */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  const featured = env.FEATURED_PROGRAM_SLUG ? await publicProgram(env.FEATURED_PROGRAM_SLUG) : null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-12 sm:py-16">
      <section className="hero-card grid items-center gap-10 rounded-lg py-12 pb-16 pl-9 pr-5 sm:py-16 sm:pb-20 sm:pl-24 sm:pr-12 md:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <p className="text-sm font-semibold text-white/85">{BRAND.name}</p>
          <h1 className="cover-title text-[1.9rem] sm:text-[3rem]">Turn your textbooks into courses. Run your tutoring program on top.</h1>
          <p className="max-w-xl text-lg opacity-90">Upload a book or slides and get lessons, flashcards and quizzes. Then bring in classes, tutors and students: scores, diagnostics, a mistake log and messages, all in one place.</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup" className="hero-button">
              Get started
            </ButtonLink>
            <ButtonLink href="/login" variant="ghost" className="hero-ghost">
              Log in
            </ButtonLink>
          </div>
        </div>
        <CoverStack />
      </section>

      <section aria-labelledby="study" className="flex flex-col gap-6">
        <h2 id="study" className="font-display text-3xl">
          For studying
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {study.map((f) => (
            <li key={f.title} className="rounded-lg border-[1.5px] border-border bg-surface p-6">
              <span aria-hidden className="block h-2 w-10 bg-accent" />
              <h3 className="mt-4 font-display text-xl font-extrabold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tutoring" className="grid items-start gap-8 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <h2 id="tutoring" className="font-display text-3xl">
            For tutoring programs
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {programs.map((f) => (
              <li key={f.title} className="rounded-lg border-[1.5px] border-border bg-surface p-5">
                <h3 className="font-display text-lg font-extrabold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <ScoreGauge score={1180} baseline={980} goal={1300} label="Example: a student's SAT progress" caption="Every score a student adds moves their gauge." />
        </div>
      </section>

      {featured && (
        <section aria-labelledby="programs" className="flex flex-col gap-4">
          <h2 id="programs" className="font-display text-3xl">
            Programs on {BRAND.name}
          </h2>
          <Link href={`/p/${featured.slug}`} className="lift flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center">
            <ProgramBadge program={featured} className="size-16" />
            <span className="flex-1">
              <span className="block font-display text-2xl font-semibold">{featured.name}</span>
              <span className="mt-1 block text-sm text-muted">
                {featured.publicBlurb ?? (featured.goalGain ? `An ${featured.subject} prep program aiming for a ${featured.goalGain}-point gain for every student.` : `A ${featured.subject} program.`)}
              </span>
            </span>
            <span className="text-sm font-semibold text-primary">About the program</span>
          </Link>
        </section>
      )}

      <section className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Joining a class or a program?</h2>
          <p className="text-sm text-muted">Use the link or code your tutor sent. Staff get their own invite from the program admin.</p>
        </div>
        <ButtonLink href="/help" variant="secondary">
          Help and FAQ
        </ButtonLink>
      </section>
      <p className="text-center text-xs text-muted">
        {BRAND.name} isn&apos;t affiliated with College Board. SAT® is a trademark of College Board. Scores from practice diagnostics are estimates. <Link href="/privacy" className="underline">Privacy</Link>
      </p>
    </div>
  );
}
