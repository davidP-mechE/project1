"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePlanAction, savePlanAction } from "@/server/actions/progress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/planning/dates";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = { courseId: string; initial: { targetDate: string; studyDays: number[]; minutesPerDay: number }; hasPlan: boolean; today: string };

/** Choose a finish date, study days and minutes per day; the plan is built from the lessons still to do. */
export function PlanForm({ courseId, initial, hasPlan, today }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState(initial.targetDate);
  const [days, setDays] = useState<number[]>(initial.studyDays);
  const [minutes, setMinutes] = useState(initial.minutesPerDay);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const save = () =>
    startTransition(async () => {
      const res = await savePlanAction(courseId, { targetDate: target, studyDays: days, minutesPerDay: minutes });
      if (!res.ok) return setResult({ tone: "error", text: res.error });
      if (res.lessons === 0) setResult({ tone: "success", text: "Every lesson is already complete! Your plan just has flashcard reviews." });
      else if (res.fits) setResult({ tone: "success", text: `Plan ready: ${res.lessons} lessons, finishing ${res.finishDay ? formatDay(res.finishDay) : "on time"}.` });
      else
        setResult({
          tone: "warning",
          text: `That's not quite enough time: at ${minutes} minutes a day you'd finish ${res.finishDay ? formatDay(res.finishDay) : "later"}. To finish by ${formatDay(target)}, plan about ${res.neededMinutesPerDay ?? "more"} minutes a day, add study days, or pick a later date.`,
        });
      router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Finish by
          <input type="date" value={target} min={today} onChange={(e) => setTarget(e.target.value)} required className="h-10 rounded-lg border border-border bg-surface px-3" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Minutes per study day: <span className="font-semibold tabular-nums">{minutes}</span>
          <input type="range" min={10} max={180} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="accent-[var(--primary)]" />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Study days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((w, i) => {
            const on = days.includes(i);
            return (
              <button
                key={w}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i].sort()))}
                className={cn("press h-9 w-12 rounded-lg border text-sm font-medium", on ? "border-primary bg-primary text-primary-text" : "border-border bg-surface hover:bg-surface-2")}
              >
                {w}
              </button>
            );
          })}
        </div>
      </fieldset>
      {result && <Alert tone={result.tone === "success" ? "success" : result.tone === "warning" ? "warning" : "error"}>{result.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || days.length === 0}>
          {pending ? "Planning…" : hasPlan ? "Re-plan from today" : "Make my plan"}
        </Button>
        {hasPlan && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              confirm("Delete this study plan?") &&
              startTransition(async () => {
                await deletePlanAction(courseId);
                setResult(null);
                router.refresh();
              })
            }
          >
            Delete plan
          </Button>
        )}
      </div>
    </form>
  );
}
