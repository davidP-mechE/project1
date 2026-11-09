"use client";

import { useState, useTransition } from "react";
import { savePreferencesAction } from "@/server/actions/progress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";

type Prefs = { dailyGoalMinutes: number; newCardsPerDay: number; reminderEmails: boolean; reminderHour: number; timezone: string };

const hourLabel = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" });

/** Daily goal, new flashcards per day, reminder emails and time zone. */
export function StudyPreferences({ initial, zones }: { initial: Prefs; zones: string[] }) {
  const [p, setP] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setMsg(null);
    setP((x) => ({ ...x, [k]: v }));
  };
  const field = "h-10 rounded-lg border border-border bg-surface px-3 text-sm";

  return (
    <Card>
      <h2 className="text-lg font-semibold">Studying</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Your daily goal, flashcards and reminders.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await savePreferencesAction(p);
            setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Daily goal (minutes)
            <input type="number" min={5} max={240} step={5} value={p.dailyGoalMinutes} onChange={(e) => set("dailyGoalMinutes", Number(e.target.value))} className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            New flashcards per day
            <input type="number" min={0} max={200} value={p.newCardsPerDay} onChange={(e) => set("newCardsPerDay", Number(e.target.value))} className={field} />
          </label>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={p.reminderEmails} onChange={(e) => set("reminderEmails", e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">Email me a reminder</span>
            <span className="block text-muted">Once a day, only if I haven&apos;t reached my goal yet. Includes cards due and lessons on my plan.</span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Reminder time
            <select value={p.reminderHour} onChange={(e) => set("reminderHour", Number(e.target.value))} disabled={!p.reminderEmails} className={field}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Time zone
            <select value={p.timezone} onChange={(e) => set("timezone", e.target.value)} className={field}>
              {(zones.includes(p.timezone) ? zones : [p.timezone, ...zones]).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        {msg && <Alert tone={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
