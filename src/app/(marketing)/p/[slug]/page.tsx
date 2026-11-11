import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ScoreGauge } from "@/components/scores/score-gauge";
import { ProgramBadge } from "@/components/brand/seal";
import { publicProgram } from "@/server/programs";
import { BRAND } from "@/lib/brand";

/**
 * A program's public page: its own name, badge and copy (set by its admin
 * on the program page), with sign-up and log-in. Only programs whose admin
 * turned the page on are shown; nothing about students is.
 */

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const p = await publicProgram((await params).slug);
  return { title: p?.name ?? "Program" };
}

const steps = [
  ["Join your class", "Your tutor sends a link or a class code."],
  ["Set your baseline and goal", "Your latest score, the score you're aiming for, and your test date."],
  ["Work the plan", "Assignments, diagnostics and your mistake log, a little every day."],
  ["Watch the gain", "Every score you add moves your chart."],
];

export default async function ProgramPage({ params }: PageProps<"/p/[slug]">) {
  const p = await publicProgram((await params).slug);
  if (!p) notFound();
  const goal = p.targets.at(-1) ?? null;
  const avg = p.schoolAverage;
  const exampleScore = avg && p.goalGain ? Math.min(1600, avg + Math.round((p.goalGain * 0.7) / 10) * 10) : null;
  const lastStep = p.goalGain ? ["Watch the gain", `Every score adds to your chart. The goal: +${p.goalGain} points.`] : steps[3];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-12 sm:py-16">
      <section className="hero-card grid items-center gap-8 rounded-[1.75rem] px-6 py-12 sm:px-12 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <ProgramBadge program={p} onDark className="size-14" />
            <p className="font-display text-sm font-semibold tracking-[0.2em] text-[#d9b84a]">{p.name.toUpperCase()}</p>
          </div>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">{p.goalGain ? `An ${p.subject} prep program built around one number: your gain.` : p.name}</h1>
          <p className="max-w-xl text-lg opacity-90">
            {avg && p.goalGain
              ? `Our school's average ${p.subject} score is about ${avg}. Our goal is a ${p.goalGain}-point gain for every student${p.targets.length ? `, toward ${p.targets.join(" and ")}` : ""}, with tutors, practice and a plan to get there.`
              : (p.publicBlurb ?? "Tutoring, practice and a plan, with your tutors.")}
          </p>
          {avg && p.goalGain && p.publicBlurb && <p className="max-w-xl opacity-90">{p.publicBlurb}</p>}
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup" className="hero-button">
              Sign up
            </ButtonLink>
            <ButtonLink href="/login" variant="ghost" className="hero-ghost">
              Log in
            </ButtonLink>
          </div>
        </div>
        {exampleScore && avg && (
          <div className="rounded-2xl bg-surface p-4 text-text shadow-lg">
            <ScoreGauge score={exampleScore} baseline={avg} goal={goal} label="Example: a student's progress" caption={`+${exampleScore - avg} since their PSAT${goal ? `, on the way to ${goal}` : ""}.`} />
          </div>
        )}
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-6">
        <h2 id="how" className="font-display text-3xl font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...steps.slice(0, 3), lastStep].map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-border bg-surface p-5">
              <span className="score-num text-3xl text-accent-ink">{i + 1}</span>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-center text-xs text-muted">
        {p.name} runs on <Link href="/" className="underline">{BRAND.name}</Link>. Your tutors and your program admin can see your work in the program; other students can&apos;t. {p.subject === "SAT" && "Not affiliated with College Board. SAT® is a trademark of College Board."}
      </p>
    </div>
  );
}
