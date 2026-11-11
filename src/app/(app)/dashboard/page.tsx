import { BaselineBanner } from "@/components/scores/baseline-banner";
import { Walkthrough } from "@/components/support/walkthrough";
import { toursToShow } from "@/server/tours";
import type { Metadata } from "next";
import Link from "next/link";
import { GoalRing, MiniRing, MinutesChart } from "@/components/dashboard/charts";
import { Celebrate } from "@/components/dashboard/celebrate";
import { ButtonLink } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { formatDay } from "@/lib/planning/dates";
import { cn } from "@/lib/utils";
import { getDashboard } from "@/server/dashboard";
import { getGameSummary } from "@/server/gamification";
import { requireUser, viewerZone } from "@/server/session";
import { studentPrograms } from "@/server/programs";
import { studentAnnouncements } from "@/server/announcements";
import { ProgramTag } from "@/components/brand/seal";
import { formatInZone } from "@/lib/dates";
import { awardBadges, myBadges } from "@/server/badges";
import { BadgeList } from "@/components/badges";
import { dueAssignments } from "@/server/classes";
import { dueText } from "@/components/classes/format";

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
  const tours = await toursToShow(user.id);
  await awardBadges(user.id).catch((err) => console.warn("[badges]", err instanceof Error ? err.message : err));
  const [d, game, due, programs, news, zone, badges] = await Promise.all([getDashboard(user.id), getGameSummary(user.id), dueAssignments(user.id), studentPrograms(user.id), studentAnnouncements(user.id), viewerZone(), myBadges(user.id)]);
  const first = d.name.split(" ")[0];
  const goalMet = d.goal.minutes >= d.goal.target;
  const cards = d.review.due + d.review.new;
  const step = nextStep(d);
  const questsDone = game.quests.filter((q) => q.done).length;
  const accuracy = game.week.answered ? Math.round((game.week.correct / game.week.answered) * 100) : null;

  const hour = d.hour;
  const lessonsDone = d.courses.reduce((n, c) => n + c.done, 0);
  const SPINE = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)"];
  const tiles = [
    { label: "Level", value: String(game.level), sub: `${game.levelSize - game.intoLevel} XP to level ${game.level + 1}`, bar: game.intoLevel / game.levelSize, href: null, tone: "var(--chart-2)" },
    { label: "Accuracy this week", value: accuracy === null ? "—" : `${accuracy}%`, sub: accuracy === null ? "answer a few questions" : `${game.week.answered} ${game.week.answered === 1 ? "answer" : "answers"}`, bar: accuracy === null ? null : accuracy / 100, href: null, tone: "var(--chart-5)" },
    { label: "Lessons finished", value: String(lessonsDone), sub: `in ${plural(d.courses.length, "course")}`, bar: null, href: "/library", tone: "var(--chart-3)" },
    { label: "Flashcards due", value: String(cards), sub: cards ? `about ${Math.max(1, Math.round(cards / 4))} min` : "all reviewed", bar: null, href: cards ? "/review" : null, tone: "var(--chart-4)" },
  ];

  return (
    <div className="mx-auto flex max-w-[84rem] flex-col gap-10 pb-6">
      <BaselineBanner userId={user.id} />
      {tours.student && <Walkthrough tour="student" />}
      <Celebrate goalMet={goalMet} streak={d.streak.current} today={d.today} />

      {/* ── Greeting ── */}
      <header className="rise flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-accent" />
            {formatDay(d.today, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {greeting(hour)}, <span className="ink-underline">{first}</span>
            <span aria-hidden>{hour < 5 || hour >= 18 ? " ☾" : " ☀"}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-lg text-muted">{step?.course ? `Pick up where you left off in ${step.course}.` : d.courses.length ? "You're all caught up. Nice work." : "Let's set up your first course."}</p>
          {programs.length > 0 && (
            <ul aria-label="Your programs" className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {programs.map((p) => (
                <li key={p.id}>
                  <ProgramTag program={p} detail={p.classes.join(", ")} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn("flex items-center gap-3 self-start rounded-2xl border px-4 py-3 md:self-auto", d.streak.current > 0 ? "streak-glow border-accent/40 bg-warning-bg" : "border-border bg-surface")}>
          <span aria-hidden className="text-3xl">{d.streak.current > 0 ? "🔥" : "✦"}</span>
          <span>
            <span className="score-num block text-2xl leading-none">{d.streak.current}</span>
            <span className="text-xs font-semibold text-muted">{d.streak.current === 0 ? "Start a streak today" : d.streak.studiedToday ? "day streak" : "day streak: study today to keep it"}</span>
          </span>
        </div>
      </header>

      {/* ── Next step, with today's goal ── */}
      <section aria-labelledby="next-step" className="hero-card rise grid items-center gap-8 rounded-[1.75rem] p-7 sm:p-10 md:grid-cols-[1fr_auto]" style={{ ["--d" as string]: "60ms" }}>
        {step ? (
          <div className="flex flex-col gap-5">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d9b84a]">
              {step.kicker}
              {step.course ? ` · ${step.course}` : ""}
            </p>
            <h2 id="next-step" className="max-w-[34rem] font-display text-3xl font-semibold leading-tight sm:text-[2.6rem]">
              {step.title}
            </h2>
            {step.progress && (
              <div className="flex max-w-md items-center gap-3 text-sm">
                <div className="hero-track h-2 flex-1 overflow-hidden rounded-full" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={step.progress.total} aria-valuenow={step.progress.done}>
                  <div className="hero-fill grow-right h-full rounded-full" style={{ width: `${step.progress.total ? Math.max(2, (step.progress.done / step.progress.total) * 100) : 0}%` }} />
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
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 id="next-step" className="font-display text-3xl font-semibold">
              {d.courses.length ? "All caught up" : "Welcome to Coursebook"}
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
          </div>
        )}
        <div className="flex items-center gap-5 md:flex-col md:gap-3 md:pr-6">
          <GoalRing minutes={d.goal.minutes} target={d.goal.target} onDark />
          <div className="md:text-center">
            <p className="font-semibold">{goalMet ? "Goal reached" : "Today's goal"}</p>
            <p className="text-xs opacity-75">
              {plural(d.todayCounts.questions, "question")} · {plural(d.todayCounts.cards, "card")} · {plural(d.todayCounts.lessons, "lesson")}
            </p>
          </div>
        </div>
      </section>

      {/* ── At a glance ── */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t, i) => {
          const body = (
            <>
              <span aria-hidden className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ background: t.tone }} />
              <span className="eyebrow">{t.label}</span>
              <span className="score-num mt-1 block text-4xl">{t.value}</span>
              <span className="text-xs text-muted">{t.sub}</span>
              {t.bar !== null && (
                <span aria-hidden className="mt-3 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span className="grow-right block h-full rounded-full" style={{ width: `${Math.max(3, t.bar * 100)}%`, background: t.tone }} />
                </span>
              )}
            </>
          );
          const cls = "lift rise relative block overflow-hidden rounded-2xl border border-border bg-surface p-5 pl-6";
          return t.href ? (
            <Link key={t.label} href={t.href} className={cn(cls, "transition-transform hover:-translate-y-0.5")} style={{ ["--d" as string]: `${120 + i * 60}ms` }}>
              {body}
            </Link>
          ) : (
            <div key={t.label} className={cls} style={{ ["--d" as string]: `${120 + i * 60}ms` }}>
              {body}
            </div>
          );
        })}
      </section>

      {/* ── Class work ── */}
      {(due.length > 0 || news.length > 0) && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {due.length > 0 && (
            <Card className="rise flex flex-col gap-4 p-6" >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl font-semibold">Assigned to you</h2>
                <Link href="/classes" className="text-sm font-semibold text-accent-ink hover:underline">
                  All classes <span aria-hidden>›</span>
                </Link>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {due.map((a) => (
                  <li key={a.id}>
                    <Link href={a.kind === "QUESTIONS" ? `/classes/assignments/${a.id}` : "/classes"} className="flex items-center justify-between gap-3 py-3 hover:text-primary">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{a.title}</span>
                        <span className="block truncate text-xs text-muted">{a.className}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", a.dueAt && a.dueAt < new Date() ? "bg-danger-bg font-semibold text-danger" : "bg-surface-2 text-muted")}>{dueText(a.dueAt, undefined, zone)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {news.length > 0 && (
            <section id="announcements" aria-labelledby="announcements-title" className="rise flex flex-col gap-3">
              <h2 id="announcements-title" className="font-display text-2xl font-semibold">
                Announcements
              </h2>
              <ul className="flex flex-col gap-3">
                {news.map((a) => (
                  <li key={a.id}>
                    <Card className={cn("p-5", a.pinned && "border-accent")}>
                      <p className="eyebrow">
                        {a.pinned && <span className="text-accent-ink">Pinned · </span>}
                        {a.class.name}
                        {a.group ? ` · ${a.group.name}` : ""}
                      </p>
                      <h3 className="mt-1 font-semibold">{a.title}</h3>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>
                      <p className="mt-2 text-xs text-muted">
                        {a.author?.name ?? "Staff"} · {formatInZone(a.createdAt, zone, "dayTime")}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ── Quests and the week ── */}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.35fr]">
        <Card className="rise flex flex-col gap-5 p-6" >
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold">Daily quests</h2>
            <span className="text-sm text-muted">{questsDone} of 3 done</span>
          </div>
          <ul className="flex flex-col gap-4">
            {game.quests.map((q) => (
              <li key={q.id} className={cn("flex items-center gap-4", q.done && "quest-done")}>
                <span className="relative flex shrink-0 items-center justify-center">
                  <MiniRing value={q.progress / q.target} done={q.done} label={`${q.label}: ${q.progress} of ${q.target}`} />
                  <span aria-hidden className={cn("absolute text-sm font-bold", q.done ? "text-success" : "text-accent-ink")}>
                    {q.done ? "✓" : QUEST_ICON[q.id]}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-semibold", q.done && "text-muted line-through")}>{q.label}</p>
                  <p className="text-xs tabular-nums text-muted">
                    {q.progress} of {q.target}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", q.done ? "bg-success-bg text-success" : "bg-accent text-accent-text")}>+{q.xp} XP</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="rise p-6">
          <MinutesChart days={d.last14} goal={d.goal.target} />
        </Card>
      </div>

      {/* ── Courses, as a shelf ── */}
      {d.courses.length > 0 && (
        <section aria-labelledby="shelf" className="rise flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="shelf" className="font-display text-2xl font-semibold">
              Your progress
            </h2>
            <Link href="/library" className="text-sm font-semibold text-accent-ink hover:underline">
              All courses <span aria-hidden>›</span>
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.courses.map((c, i) => (
              <li key={c.id}>
                <Link href={`/courses/${c.id}`} className="lift group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-surface p-5 pl-7 transition-transform hover:-translate-y-0.5">
                  <span aria-hidden className="absolute inset-y-0 left-0 w-3" style={{ background: SPINE[i % SPINE.length] }} />
                  <span aria-hidden className="absolute inset-y-0 left-3 w-px bg-black/10" />
                  <span className="line-clamp-2 font-semibold group-hover:underline">{c.title}</span>
                  <span className="mt-auto flex items-center gap-3 text-xs text-muted">
                    <ProgressBar value={c.pct} label={`${c.title} progress`} className="h-1.5" />
                    <span className="shrink-0 tabular-nums">
                      {c.done}/{c.total}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Worth another look, and badges ── */}
      <div className={cn("grid items-start gap-6", badges.length > 0 && "lg:grid-cols-[1fr_1fr]")}>
        <Card className="rise flex flex-col gap-4 p-6">
          <h2 className="font-display text-2xl font-semibold">Worth another look</h2>
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
        {badges.length > 0 && (
          <section aria-labelledby="badges-title" className="rise flex flex-col gap-3">
            <h2 id="badges-title" className="font-display text-2xl font-semibold">
              Your badges
            </h2>
            <BadgeList badges={badges.slice(0, 8)} zone={zone} />
          </section>
        )}
      </div>
    </div>
  );
}
