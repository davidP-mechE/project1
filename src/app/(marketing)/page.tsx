import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ScoreGauge } from "@/components/scores/score-gauge";
import { CoursebookMark, ProgramBadge } from "@/components/brand/seal";
import { getSession } from "@/server/session";
import { publicProgram } from "@/server/programs";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";

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

/** The public front page: what Coursebook is. Logged-in people go straight to Today. */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  const featured = env.FEATURED_PROGRAM_SLUG ? await publicProgram(env.FEATURED_PROGRAM_SLUG) : null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-12 sm:py-16">
      <section className="hero-card grid items-center gap-8 rounded-2xl px-6 py-12 sm:px-12 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <p className="font-display text-sm font-semibold tracking-[0.2em] text-[#d9b84a]">{BRAND.name.toUpperCase()}</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">Turn your textbooks into courses. Run your tutoring program on top.</h1>
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
        <div aria-hidden className="hidden justify-center md:flex">
          <CoursebookMark className="size-48 drop-shadow-xl" />
        </div>
      </section>

      <section aria-labelledby="study" className="flex flex-col gap-6">
        <h2 id="study" className="font-display text-3xl font-semibold">
          For studying
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {study.map((f) => (
            <li key={f.title} className="lift rounded-2xl border border-border bg-surface p-6">
              <span aria-hidden className="block h-1 w-10 rounded-full bg-accent" />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tutoring" className="grid items-start gap-8 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <h2 id="tutoring" className="font-display text-3xl font-semibold">
            For tutoring programs
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {programs.map((f) => (
              <li key={f.title} className="rounded-2xl border border-border bg-surface p-5">
                <h3 className="font-semibold">{f.title}</h3>
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
          <h2 id="programs" className="font-display text-3xl font-semibold">
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
            <span className="text-sm font-semibold text-primary">About the program →</span>
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
