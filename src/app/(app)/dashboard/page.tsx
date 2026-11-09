import type { Metadata } from "next";
import Link from "next/link";
import { GoalRing, MinutesChart } from "@/components/dashboard/charts";
import { Celebrate } from "@/components/dashboard/celebrate";
import { ButtonLink } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { formatDay } from "@/lib/planning/dates";
import { cn } from "@/lib/utils";
import { getDashboard } from "@/server/dashboard";
import { getGameSummary } from "@/server/gamification";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Today" };

function greeting(hour: number) {
  return hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const QUEST_ICON: Record<string, string> = { answer: "?", correct: "✓", cards: "▤", lesson: "❑", minutes: "◷" };

type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

/** The one thing to do next: a planned lesson, else where you left off, else flashcards. */
function nextStep(d: Dashboard) {
  const planned = d.plan[0];
  if (planned) {
    const c = d.courses.find((x) => x.id === planned.courseId);
    return {
      kicker: planned.overdue ? `Planned for ${formatDay(planned.day, { weekday: "long" })}` : "On your plan today",
      course: planned.courseTitle,
      title: planned.lessonTitle,
      href: `/courses/${planned.courseId}/lessons/${planned.lessonId}`,
      cta: "Start lesson",
      minutes: planned.minutes,
      progress: c ? { done: c.done, total: c.total } : null,
    };
  }
  const c = d.courses.find((x) => x.resume);
  if (c?.resume) {
    return {
      kicker: c.resume.reason === "continue" ? "Pick up where you left off" : "Your next lesson",
      course: c.title,
      title: c.resume.title,
      href: `/courses/${c.id}/lessons/${c.resume.id}`,
      cta: c.resume.reason === "continue" ? "Continue lesson" : "Start lesson",
      minutes: null,
      progress: { done: c.done, total: c.total },
    };
  }
  const cards = d.review.due + d.review.new;
  if (cards > 0) {
    return { kicker: "Keep it fresh", course: null, title: "Review your flashcards", href: "/review", cta: "Start reviewing", minutes: Math.max(1, Math.round(cards / 4)), progress: null };
  }
  return null;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [d, game] = await Promise.all([getDashboard(user.id), getGameSummary(user.id)]);
  const first = d.name.split(" ")[0];
  const goalMet = d.goal.minutes >= d.goal.target;
  const cards = d.review.due + d.review.new;
  const step = nextStep(d);
  const questsDone = game.quests.filter((q) => q.done).length;
  const accuracy = game.week.answered ? Math.round((game.week.correct / game.week.answered) * 100) : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Celebrate goalMet={goalMet} streak={d.streak.current} today={d.today} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">{formatDay(d.today, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            {greeting(d.hour)}, {first}!
          </h1>
          <p className="mt-1 text-muted">{step?.course ? `Pick up where you left off in ${step.course}.` : d.courses.length ? "You're all caught up. Nice work." : "Let's set up your first course."}</p>
        </div>
        <p
          className={cn(
            "inline-flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm font-semibold sm:self-auto",
            d.streak.current > 0 ? "streak-glow bg-warning-bg text-warning" : "bg-surface-2 text-muted",
          )}
        >
          <span aria-hidden>{d.streak.current > 0 ? "🔥" : "🌙"}</span>
          {d.streak.current === 0 ? "Start a streak today" : d.streak.studiedToday ? `${d.streak.current}-day streak` : `${d.streak.current}-day streak: study today to keep it`}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* ── Main column ── */}
        <div className="flex min-w-0 flex-col gap-6">
          {step ? (
            <section aria-labelledby="next-step" className="hero-card stagger flex flex-col gap-5 rounded-3xl p-6 sm:p-8">
              <p className="text-sm font-semibold opacity-85">
                Your next step{step.course ? ` · ${step.course}` : ""}
              </p>
              <div className="max-w-[36rem]">
                <p className="text-sm opacity-85">{step.kicker}</p>
                <h2 id="next-step" className="mt-1 text-3xl font-semibold sm:text-4xl">
                  {step.title}
                </h2>
              </div>
              {step.progress && (
                <div className="flex max-w-md items-center gap-3 text-sm">
                  <div className="hero-track h-2 flex-1 overflow-hidden rounded-full" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={step.progress.total} aria-valuenow={step.progress.done}>
                    <div className="hero-fill h-full rounded-full" style={{ width: `${step.progress.total ? (step.progress.done / step.progress.total) * 100 : 0}%` }} />
                  </div>
                  <span className="shrink-0 font-semibold">
                    {step.progress.done} of {step.progress.total} lessons
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <ButtonLink href={step.href} className="hero-button">
                  {step.cta} <span aria-hidden>→</span>
                </ButtonLink>
                {step.minutes ? <span className="text-sm font-semibold opacity-85">About {step.minutes} min</span> : null}
              </div>
            </section>
          ) : (
            <section aria-labelledby="next-step" className="hero-card stagger flex flex-col gap-4 rounded-3xl p-6 sm:p-8">
              <h2 id="next-step" className="text-3xl font-semibold">
                {d.courses.length ? "All caught up 🌙" : "Welcome to Coursebook"}
              </h2>
              <p className="max-w-md opacity-90">
                {d.courses.length
                  ? "Nothing is due right now. Try a practice set to lock in what you've learned, or upload something new."
                  : "Upload a textbook or your lecture slides, and Coursebook turns them into a course with lessons, practice and flashcards."}
              </p>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/library/upload" className="hero-button">
                  Upload a textbook
                </ButtonLink>
                <ButtonLink href="/slides/upload" variant="ghost" className="hero-ghost">
                  Upload slides
                </ButtonLink>
              </div>
            </section>
          )}

          <Card className="stagger flex flex-col gap-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold">Your progress</h2>
              {d.courses.length > 0 && (
                <Link href="/library" className="text-sm font-semibold text-accent-ink hover:underline">
                  All courses <span aria-hidden>›</span>
                </Link>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Lessons done", String(d.courses.reduce((n, c) => n + c.done, 0)), "all time"],
                ["Accuracy", accuracy === null ? "—" : `${accuracy}%`, accuracy === null ? "answer a few questions" : `${game.week.answered} ${game.week.answered === 1 ? "answer" : "answers"} this week`],
                ["Studied today", `${d.goal.minutes} min`, `goal: ${d.goal.target} min`],
                ["Cards due", String(cards), cards ? "ready to review" : "all reviewed"],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-2xl bg-surface-2 p-4">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
                  <dd className="text-xs text-muted">{sub}</dd>
                </div>
              ))}
            </dl>
            {d.courses.length > 0 && (
              <ul className="flex flex-col gap-4">
                {d.courses.map((c) => (
                  <li key={c.id}>
                    <Link href={`/courses/${c.id}`} className="group flex flex-col gap-1.5">
                      <span className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-semibold group-hover:underline">{c.title}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {c.done}/{c.total} · {c.pct}%
                        </span>
                      </span>
                      <ProgressBar value={c.pct} label={`${c.title} progress`} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <MinutesChart days={d.last14} goal={d.goal.target} />
          </Card>

          <Card className="stagger flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Worth another look</h2>
            {d.weakTopics.length === 0 && d.confusing.length === 0 && d.leeches.length === 0 ? (
              <p className="text-sm text-muted">No weak spots yet. Topics you often get wrong, lessons you marked confusing and cards you keep forgetting will show up here.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {d.weakTopics.map((w) => (
                  <li key={w.topic} className="flex items-center justify-between gap-3 rounded-xl p-2 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{w.topic}</span>
                      <span className="text-xs text-muted">
                        {Math.round(w.score * 100)}% across {w.attempts} answers{w.lesson ? ` · ${w.lesson.title}` : ""}
                      </span>
                    </span>
                    {w.lesson && (
                      <Link href={`/courses/${w.lesson.courseId}/practice/session?lesson=${w.lesson.id}`} className="press shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface">
                        Practise
                      </Link>
                    )}
                  </li>
                ))}
                {d.confusing.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl p-2 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.title}</span>
                      <span className="text-xs text-muted">You marked this lesson confusing</span>
                    </span>
                    <Link href={`/courses/${l.courseId}/lessons/${l.id}`} className="press shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface">
                      Revisit
                    </Link>
                  </li>
                ))}
                {d.leeches.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-xl p-2 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.front.replace(/[$*_`]/g, "")}</span>
                      <span className="text-xs text-muted">
                        Flashcard forgotten {c.lapses} times{c.lesson ? ` · ${c.lesson.title}` : ""}
                      </span>
                    </span>
                    {c.lesson && (
                      <Link href={`/courses/${c.lesson.courseId}/lessons/${c.lesson.id}`} className="press shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface">
                        Reread
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ── Side column ── */}
        <div className="flex flex-col gap-6">
          <Card className="stagger flex flex-col gap-4 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Daily quests</h2>
              <span className="text-sm text-muted">
                {questsDone} of 3 done
              </span>
            </div>
            <ul className="flex flex-col gap-4">
              {game.quests.map((q) => (
                <li key={q.id} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold", q.done ? "bg-success-bg text-success" : "bg-warning-bg text-warning")}
                  >
                    {q.done ? "✓" : QUEST_ICON[q.id]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", q.done && "text-muted line-through")}>{q.label}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <ProgressBar value={(q.progress / q.target) * 100} label={`${q.label}: ${q.progress} of ${q.target}`} className="h-1.5" />
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {q.progress}/{q.target}
                      </span>
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", q.done ? "bg-success-bg text-success" : "bg-accent text-[#1b1f33]")}>+{q.xp} XP</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="stagger flex items-center gap-4 p-5">
            <GoalRing minutes={d.goal.minutes} target={d.goal.target} />
            <div>
              <h2 className="text-lg font-semibold">{goalMet ? "Goal reached 🎉" : "Today's goal"}</h2>
              <p className="text-sm text-muted">{goalMet ? "Anything more is a bonus." : `${d.goal.target - d.goal.minutes} more minutes to go.`}</p>
              <p className="mt-2 text-xs text-muted">
                {plural(d.todayCounts.questions, "question")} · {plural(d.todayCounts.cards, "card")} · {plural(d.todayCounts.lessons, "lesson")} today
              </p>
            </div>
          </Card>

          <Card className="stagger flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Level {game.level}</h2>
              <span className="text-sm font-semibold tabular-nums text-accent-ink">{game.xp.toLocaleString("en-US")} XP</span>
            </div>
            <ProgressBar value={(game.intoLevel / game.levelSize) * 100} label={`Level ${game.level} progress`} />
            <p className="text-xs text-muted">
              {game.levelSize - game.intoLevel} XP to level {game.level + 1}. Earn XP by answering questions, reviewing cards, finishing lessons and daily quests.
            </p>
          </Card>

          {cards > 0 && step?.href !== "/review" && (
            <Link href="/review" className="press-soft lift flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-2">
              <span>
                <span className="block font-semibold">Review flashcards</span>
                <span className="text-sm text-muted">
                  {d.review.due} due · {d.review.new} new · about {Math.max(1, Math.round(cards / 4))} min
                </span>
              </span>
              <span aria-hidden className="text-xl">
                ▤
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
