"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { ageCheckAction, deleteResultAction, setSharesAction } from "@/server/actions/academic-index";

/**
 * A neutral age screen (COPPA): a birth date, with no hint of the cut-off.
 * Only the outcome is saved.
 */
export function AgeCheckForm() {
  const router = useRouter();
  const id = useId();
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await ageCheckAction(date);
          if (r.ok) router.refresh();
          else setError(r.error);
        });
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">Date of birth</label>
      <input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClasses} max-w-xs`} />
      <p className="text-xs text-muted">We only keep whether you can use this feature, not your birth date.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !date}>Continue</Button>
      </div>
    </form>
  );
}

/** Choose which classes' tutors can see the index (private by default). */
export function ShareForm({ classes, shared }: { classes: { id: string; name: string }[]; shared: string[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(new Set(shared));
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (classes.length === 0) return <p className="text-sm text-muted">Your Academic Index is private. When you join a tutor class, you can choose to share it with that class here.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setSharesAction([...picked]);
          setMsg(r.ok ? { tone: "success", text: picked.size ? "Saved. Your tutors in those classes can see your score and breakdown (not your essays)." : "Saved. Your Academic Index is private." } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">Private unless you choose a class. Tutors see your score, tier, breakdown and history, never your essays.</legend>
        {classes.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setPicked(next);
              }}
              className="size-4"
            />
            Share with {c.name}
          </label>
        ))}
      </fieldset>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>Save sharing</Button>
      </div>
    </form>
  );
}

export function DeleteResultButton({ resultId }: { resultId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this score from your history?")) return;
        start(async () => {
          const r = await deleteResultAction(resultId);
          if (r.ok) router.push("/academic-index");
        });
      }}
    >
      Delete this score
    </Button>
  );
}
