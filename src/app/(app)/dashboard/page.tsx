import type { Metadata } from "next";
import Link from "next/link";
import { GoalRing, MinutesChart } from "@/components/dashboard/charts";
import { Celebrate } from "@/components/dashboard/celebrate";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, ProgressBar } from "@/components/ui/misc";
import { formatDay } from "@/lib/planning/dates";
import { getDashboard } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Today" };

function greeting(hour: number) {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await getDashboard(user.id);
  const first = d.name.split(" ")[0];
  const goalMet = d.goal.minutes >= d.goal.target;
  const cards = d.review.due + d.review.new;

  if (d.courses.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Welcome, {first}!</h1>
        <EmptyState title="Nothing to study yet" action={<ButtonLink href="/library/upload">Upload a textbook</ButtonLink>}>
          Upload a textbook and generate its course. Your progress, streak and daily plan will show up here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Celebrate goalMet={goalMet} streak={d.streak.current} today={d.today} />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{formatDay(d.today, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting(d.hour)}, {first}
          {d.streak.current >= 3 ? " 🔥" : ""}
        </h1>
      </header>

      {/* Today at a glance */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="stagger flex flex-col gap-5 sm:flex-row sm:items-center">
          <GoalRing minutes={d.goal.minutes} target={d.goal.target} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">{goalMet ? "Daily goal reached 🎉" : "Today's goal"}</h2>
              <p className="text-sm text-muted">
                {goalMet ? "Great work. Anything more is a bonus." : `${d.goal.target - d.goal.minutes} more minutes to reach your ${d.goal.target}-minute goal.`}
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Cards", d.todayCounts.cards],
                ["Questions", d.todayCounts.questions],
                ["Lessons", d.todayCounts.lessons],
              ].map(([label, n]) => (
                <div key={label} className="rounded-lg bg-surface-2 px-2 py-2">
                  <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                  <dt className="text-xs text-muted">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </Card>
        <Card className="stagger flex items-center gap-4" >
          <div className={`flex size-16 shrink-0 items-center justify-center rounded-2xl text-3xl ${d.streak.current > 0 ? "streak-glow bg-warning-bg" : "bg-surface-2 grayscale"}`} aria-hidden>
            🔥
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {d.streak.current} <span className="text-base font-normal text-muted">day{d.streak.current === 1 ? "" : "s"}</span>
            </p>
            <p className="text-sm text-muted">
              {d.streak.current === 0
                ? "Study today to start a streak."
                : d.streak.studiedToday
                  ? `Streak safe for today. Longest: ${d.streak.longest} days.`
                  : "Study today to keep your streak going!"}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Up next */}
        <Card className="stagger flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Up next</h2>
          {cards > 0 && (
            <Link href="/review" className="press-soft flex items-center justify-between gap-3 rounded-xl border border-border p-3 hover:bg-surface-2">
              <span>
                <span className="block font-medium">Review flashcards</span>
                <span className="text-sm text-muted">
                  {d.review.due} due · {d.review.new} new · about {Math.max(1, Math.round(cards / 4))} min
                </span>
              </span>
              <span aria-hidden className="text-xl">🃏</span>
            </Link>
          )}
          {d.plan.map((p) => (
            <Link key={`${p.lessonId}-${p.day}`} href={`/courses/${p.courseId}/lessons/${p.lessonId}`} className="press-soft flex items-center justify-between gap-3 rounded-xl border border-border p-3 hover:bg-surface-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.lessonTitle}</span>
                <span className="text-sm text-muted">
                  {p.courseTitle} · ~{p.minutes} min{p.overdue ? ` · planned for ${formatDay(p.day, { weekday: "short" })}` : " · on your plan today"}
                </span>
              </span>
              <span aria-hidden className="text-xl">{p.overdue ? "⏰" : "📘"}</span>
            </Link>
          ))}
          {d.plan.length === 0 &&
            d.courses
              .filter((c) => c.resume)
              .slice(0, 3)
              .map((c) => (
                <Link key={c.id} href={`/courses/${c.id}/lessons/${c.resume!.id}`} className="press-soft flex items-center justify-between gap-3 rounded-xl border border-border p-3 hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.resume!.title}</span>
                    <span className="text-sm text-muted">
                      {c.resume!.reason === "continue" ? "Continue" : c.resume!.reason === "start" ? "Start" : "Next"} · {c.title}
                    </span>
                  </span>
                  <span aria-hidden className="text-xl">📘</span>
                </Link>
              ))}
          {cards === 0 && d.plan.length === 0 && d.courses.every((c) => !c.resume) && <p className="text-sm text-muted">You&apos;re all caught up. 🎉</p>}
          {d.overdueCount > 0 && (
            <p className="text-xs text-muted">
              {d.overdueCount} planned {d.overdueCount === 1 ? "lesson is" : "lessons are"} behind schedule. You can re-plan from the course&apos;s Plan tab.
            </p>
          )}
        </Card>

        <Card className="stagger">
          <MinutesChart days={d.last14} goal={d.goal.target} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Courses */}
        <Card className="stagger flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Your courses</h2>
          <ul className="flex flex-col gap-4">
            {d.courses.map((c) => (
              <li key={c.id}>
                <Link href={`/courses/${c.id}`} className="group flex flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium group-hover:underline">{c.title}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {c.done}/{c.total} · {c.pct}%
                    </span>
                  </span>
                  <ProgressBar value={c.pct} label={`${c.title} progress`} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {/* Weak spots */}
        <Card className="stagger flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Worth another look</h2>
          {d.weakTopics.length === 0 && d.confusing.length === 0 && d.leeches.length === 0 ? (
            <p className="text-sm text-muted">No weak spots yet. Topics you often get wrong, lessons you marked confusing and cards you keep forgetting will show up here.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.weakTopics.map((w) => (
                <li key={w.topic} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{w.topic}</span>
                    <span className="text-xs text-muted">
                      {Math.round(w.score * 100)}% across {w.attempts} answers{w.lesson ? ` · ${w.lesson.title}` : ""}
                    </span>
                  </span>
                  {w.lesson && (
                    <Link href={`/courses/${w.lesson.courseId}/lessons/${w.lesson.id}#practice`} className="press shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-2">
                      Practise
                    </Link>
                  )}
                </li>
              ))}
              {d.confusing.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.title}</span>
                    <span className="text-xs text-muted">You marked this lesson confusing</span>
                  </span>
                  <Link href={`/courses/${l.courseId}/lessons/${l.id}`} className="press shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-2">
                    Revisit
                  </Link>
                </li>
              ))}
              {d.leeches.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.front.replace(/[$*_`]/g, "")}</span>
                    <span className="text-xs text-muted">Flashcard forgotten {c.lapses} times{c.lesson ? ` · ${c.lesson.title}` : ""}</span>
                  </span>
                  {c.lesson && (
                    <Link href={`/courses/${c.lesson.courseId}/lessons/${c.lesson.id}`} className="press shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-2">
                      Reread
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
