import type { Metadata } from "next";
import Link from "next/link";
import { CourseHeader } from "@/components/course/course-header";
import { PlanForm } from "@/components/plan/plan-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/misc";
import { addDays, formatDay } from "@/lib/planning/dates";
import { cn } from "@/lib/utils";
import { getCourseOr404 } from "@/server/course-page";
import { defaultTarget, getPlan } from "@/server/plan";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Study plan" };

export default async function PlanPage({ params }: PageProps<"/courses/[courseId]/plan">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  const { plan, today } = await getPlan(user.id, courseId);
  const byDay = new Map<string, NonNullable<typeof plan>["items"]>();
  for (const i of plan?.items ?? []) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  // Show overdue days, today, and days with lessons; days with only a flashcard review are summarized.
  const allDays = [...byDay.keys()].filter((d) => d >= today || byDay.get(d)!.some((i) => i.kind === "LESSON" && !i.done));
  const shownDays = allDays.filter((d) => d <= today || byDay.get(d)!.some((i) => i.kind === "LESSON")).slice(0, 40);
  const reviewOnly = allDays.filter((d) => d > today && !shownDays.includes(d));

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />
      <Card className="mb-6">
        <h2 className="text-lg font-semibold">{plan ? "Your study plan" : "Make a study plan"}</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          {plan
            ? `${plan.lessonsLeft} lessons left · ${plan.daysLeft} days until ${formatDay(plan.targetDate, { month: "long", day: "numeric" })}.`
            : "Pick when you want to finish and when you can study. Your lessons are spread over those days, with a short flashcard review each day."}
        </p>
        <PlanForm
          courseId={courseId}
          today={today}
          hasPlan={Boolean(plan)}
          initial={plan ? { targetDate: plan.targetDate, studyDays: plan.studyDays, minutesPerDay: plan.minutesPerDay } : { targetDate: defaultTarget(today), studyDays: [1, 2, 3, 4, 5], minutesPerDay: 30 }}
        />
      </Card>

      {plan && plan.overdue > 0 && (
        <Alert tone="warning" className="mb-4">
          You&apos;re {plan.overdue} {plan.overdue === 1 ? "lesson" : "lessons"} behind. That&apos;s fine: catch up when you can, or use <strong>Re-plan from today</strong> to spread them out again.
        </Alert>
      )}

      {plan && (
        <ol className="flex flex-col gap-3">
          {shownDays.map((day) => {
            const items = byDay.get(day)!;
            const isToday = day === today;
            const past = day < today;
            return (
              <li key={day} className={cn("rounded-xl border bg-surface p-4", isToday ? "border-primary shadow-sm" : "border-border")}>
                <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
                  <span>
                    {isToday ? "Today" : day === addDays(today, 1) ? "Tomorrow" : formatDay(day)}
                    {past && <span className="ml-2 font-normal text-warning">missed</span>}
                  </span>
                  <span className="font-normal text-muted">~{items.reduce((n, i) => n + i.minutes, 0)} min</span>
                </h3>
                <ul className="flex flex-col gap-1">
                  {items
                    .filter((i) => !past || (i.kind === "LESSON" && !i.done))
                    .map((i) => (
                      <li key={i.id} className="flex items-center gap-2 text-sm">
                        <span aria-hidden className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]", i.done ? "border-success bg-success text-white dark:text-bg" : "border-border")}>
                          {i.done ? "✓" : ""}
                        </span>
                        {i.kind === "LESSON" && i.lessonId ? (
                          <Link href={`/courses/${courseId}/lessons/${i.lessonId}`} className={cn("min-w-0 flex-1 truncate hover:underline", i.done && "text-muted line-through")}>
                            {i.title}
                          </Link>
                        ) : (
                          <Link href={`/review?course=${courseId}`} className={cn("min-w-0 flex-1 truncate hover:underline", i.done && "text-muted line-through")}>
                            {i.title}
                          </Link>
                        )}
                        <span className="shrink-0 text-xs text-muted">{i.minutes} min</span>
                        <span className="sr-only">{i.done ? "(done)" : ""}</span>
                      </li>
                    ))}
                </ul>
              </li>
            );
          })}
          {reviewOnly.length > 0 && (
            <li className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">
              Plus a 10-minute flashcard review on {reviewOnly.length} other study {reviewOnly.length === 1 ? "day" : "days"}, through {formatDay(reviewOnly[reviewOnly.length - 1])}.
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
