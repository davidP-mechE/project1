"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { Markdown } from "@/components/lesson/markdown";
import { answerLiveAction, closeLiveAction, joinLiveAction, revealLiveAction, startLiveAction } from "@/server/actions/practice-tools";
import { cn } from "@/lib/utils";

const LETTERS = ["A", "B", "C", "D"];

/** Poll a run's state while the page is visible. */
function usePoll<T>(runId: string, everyMs: number, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [stale, setStale] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/live/${runId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [runId]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, stale, load };
}

// ─── Starting a run ──────────────────────────────────────────────────────

export function StartLiveForm({ classId, sets, sessions, groups }: { classId: string; sets: { id: string; title: string; count: number }[]; sessions: { id: string; label: string }[]; groups: { id: string; name: string }[] }) {
  const router = useRouter();
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [kind, setKind] = useState<"WARM_UP" | "EXIT_TICKET">("WARM_UP");
  const [sessionId, setSessionId] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const s = useId();
  const ses = useId();
  if (!sets.length) return <p className="text-sm text-muted">No published sets of 20 questions or fewer yet. Make a short set in the question bank.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await startLiveAction(classId, { setId, kind, sessionId: sessionId || null, groupIds });
          if (!r.ok) return setError(r.error);
          router.push(`/teach/${classId}/live/${r.runId}`);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={s} className="text-sm font-medium">Set</label>
          <select id={s} value={setId} onChange={(e) => setSetId(e.target.value)} className={inputClasses}>
            {sets.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.count} question{x.count === 1 ? "" : "s"})</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ses} className="text-sm font-medium">Session (optional)</label>
          <select id={ses} value={sessionId} onChange={(e) => setSessionId(e.target.value)} className={inputClasses}>
            <option value="">A new one when I close the run</option>
            {sessions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-medium">Kind</legend>
        <label className="flex items-center gap-2"><input type="radio" name="kind" checked={kind === "WARM_UP"} onChange={() => setKind("WARM_UP")} /> Warm-up</label>
        <label className="flex items-center gap-2"><input type="radio" name="kind" checked={kind === "EXIT_TICKET"} onChange={() => setKind("EXIT_TICKET")} /> Exit ticket</label>
      </fieldset>
      {groups.length > 0 && (
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 font-medium">Only these groups (optional; none ticked = everyone you teach)</legend>
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2">
              <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => setGroupIds((x) => (x.includes(g.id) ? x.filter((y) => y !== g.id) : [...x, g.id]))} /> {g.name}
            </label>
          ))}
        </fieldset>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div><Button type="submit" disabled={pending || !setId}>{pending ? "Starting…" : "Start live run"}</Button></div>
    </form>
  );
}

// ─── Staff screen ────────────────────────────────────────────────────────

type StaffState = {
  run: { id: string; code: string; kind: "WARM_UP" | "EXIT_TICKET"; status: string; title: string; className: string; classId: string; revealed: string[] };
  canTeach: boolean;
  eligible: number;
  joined: number;
  questions: { id: string; number: number; type: "mcq" | "grid_in"; stem: string; choices: string[]; answer: string; explanation: string; answered: number; correct: number; counts: { answer: string; n: number }[]; revealed: boolean }[];
};

export function StaffLiveScreen({ initial }: { initial: StaffState }) {
  const { data, stale, load } = usePoll<StaffState>(initial.run.id, 3000, initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = data.run.status === "OPEN";
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Something went wrong."));
      await load();
    });
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <p className="text-sm text-muted">{open ? "Students join from Today, or at /live with the code" : "This run has ended"}</p>
          <p className="font-display text-5xl tracking-widest" aria-label={`Join code ${data.run.code.split("").join(" ")}`}>{data.run.code}</p>
        </div>
        <p className="text-lg" role="status" aria-live="polite">
          <span className="font-semibold tabular-nums">{data.joined}</span> of {data.eligible} student{data.eligible === 1 ? "" : "s"} answering
        </p>
        {data.canTeach && (
          <div className="ml-auto flex flex-wrap gap-2">
            {open && <Button variant="secondary" disabled={pending || data.questions.every((q) => q.revealed)} onClick={() => act(() => revealLiveAction(data.run.id, "all"))}>Reveal all answers</Button>}
            {open && <Button variant="danger" disabled={pending} onClick={() => act(() => closeLiveAction(data.run.id))}>Close the run</Button>}
          </div>
        )}
        {stale && <Alert tone="warning" className="basis-full">Can&apos;t reach the server; the numbers will update when it&apos;s back.</Alert>}
        {error && <Alert tone="error" className="basis-full">{error}</Alert>}
        {!open && <Alert className="basis-full">Saved to the class&apos;s sessions, and everyone who answered is marked present. Answers count toward each student&apos;s practice.</Alert>}
      </Card>
      <ol className="flex flex-col gap-3">
        {data.questions.map((q) => {
          const pct = q.answered ? Math.round((q.correct / q.answered) * 100) : null;
          const top = Math.max(1, ...q.counts.map((c) => c.n));
          return (
            <li key={q.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="font-semibold">Question {q.number}</h2>
                  <span className="text-sm tabular-nums">{q.answered} answered</span>
                  <span className={cn("text-sm font-semibold tabular-nums", pct === null ? "text-muted" : pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-danger")}>{pct === null ? "No answers yet" : `${pct}% correct`}</span>
                  {data.canTeach && open && (
                    <Button size="sm" variant="ghost" className="ml-auto" disabled={pending || q.revealed} onClick={() => act(() => revealLiveAction(data.run.id, q.id))}>
                      {q.revealed ? "Revealed to students" : "Reveal answer"}
                    </Button>
                  )}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Show the question and answer</summary>
                  <div className="mt-2 text-sm">
                    <Markdown>{q.stem}</Markdown>
                    <p className="mt-2 font-medium">Answer: {q.answer}</p>
                    {q.explanation && <Markdown className="mt-1 text-muted">{q.explanation}</Markdown>}
                  </div>
                </details>
                <table className="w-full max-w-md text-sm">
                  <caption className="sr-only">How many picked each answer for question {q.number}</caption>
                  <tbody>
                    {q.counts.length === 0 ? (
                      <tr><td className="text-muted">No answers yet.</td></tr>
                    ) : (
                      q.counts.map((c) => (
                        <tr key={c.answer}>
                          <th scope="row" className={cn("w-16 py-0.5 pr-2 text-left font-medium", c.answer === q.answer && "text-success")}>{c.answer}{c.answer === q.answer ? " ✓" : ""}</th>
                          <td className="py-0.5">
                            <span className="flex items-center gap-2">
                              <span aria-hidden className={cn("h-3 rounded-sm", c.answer === q.answer ? "bg-success" : "bg-primary")} style={{ width: `${Math.max(2, (c.n / top) * 100)}%` }} />
                              <span className="tabular-nums">{c.n}</span>
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Student screen ──────────────────────────────────────────────────────

type StudentState = {
  run: { id: string; kind: "WARM_UP" | "EXIT_TICKET"; status: string; title: string; className: string };
  questions: { id: string; number: number; type: "mcq" | "grid_in"; stem: string; choices: string[]; imageUrl: string | null; mine: { answer: string; correct: boolean | null } | null; reveal: { answer: string; explanation: string } | null }[];
};

export function StudentLiveScreen({ initial }: { initial: StudentState }) {
  const { data, load } = usePoll<StudentState>(initial.run.id, 4000, initial);
  const open = data.run.status === "OPEN";
  const done = data.questions.filter((q) => q.mine).length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" role="status" aria-live="polite">
        {open ? `${done} of ${data.questions.length} answered. Your tutor will show the answers.` : "This run has ended. Here are the answers."}
      </p>
      <ol className="flex flex-col gap-3">
        {data.questions.map((q) => (
          <li key={q.id}>
            <StudentQuestion runId={data.run.id} q={q} open={open} onAnswered={load} />
          </li>
        ))}
      </ol>
      {!open && <Link href="/dashboard" className="self-start text-sm text-primary underline-offset-2 hover:underline">Back to Today</Link>}
    </div>
  );
}

function StudentQuestion({ runId, q, open, onAnswered }: { runId: string; q: StudentState["questions"][number]; open: boolean; onAnswered: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const gridId = useId();
  const canAnswer = open && !q.mine && !q.reveal;
  const submit = (answer: string) =>
    start(async () => {
      const r = await answerLiveAction(runId, q.id, answer);
      if (!r.ok) setError(r.error);
      await onAnswered();
    });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Question {q.number}</h2>
      <Markdown>{q.stem}</Markdown>
      {q.type === "mcq" ? (
        <fieldset disabled={!canAnswer || pending} className="flex flex-col gap-2">
          <legend className="sr-only">Choose an answer to question {q.number}</legend>
          {q.choices.map((c, i) => {
            const letter = LETTERS[i];
            const picked = q.mine?.answer === letter;
            const right = q.reveal?.answer === letter;
            return (
              <button
                key={letter}
                type="button"
                onClick={() => submit(letter)}
                aria-pressed={picked}
                className={cn("flex items-start gap-2 rounded-md border-[1.5px] px-3 py-2 text-left text-sm", right ? "border-success bg-success-bg" : picked ? "border-primary" : "border-border", canAnswer && "hover:border-text")}
              >
                <span className="font-semibold">{letter}.</span>
                <Markdown>{c}</Markdown>
              </button>
            );
          })}
        </fieldset>
      ) : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(value); }}>
          <div className="flex flex-col gap-1">
            <label htmlFor={gridId} className="text-sm font-medium">Your answer</label>
            <input id={gridId} disabled={!canAnswer} value={q.mine?.answer ?? value} onChange={(e) => setValue(e.target.value)} maxLength={10} className={`${inputClasses} w-40`} />
          </div>
          {canAnswer && <Button type="submit" size="sm" disabled={pending || !value.trim()}>Submit</Button>}
        </form>
      )}
      {q.mine && !q.reveal && <p className="text-sm text-muted">Answer saved. Wait for your tutor to show the answer.</p>}
      {q.reveal && (
        <div className="rounded-md bg-surface-2 p-3 text-sm">
          <p className="font-semibold">
            Answer: {q.reveal.answer}
            {q.mine ? (q.mine.correct ? " · You got it right." : ` · You answered ${q.mine.answer}.`) : " · You didn't answer this one."}
          </p>
          {q.reveal.explanation && <Markdown className="mt-1">{q.reveal.explanation}</Markdown>}
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </Card>
  );
}

// ─── Joining with a code ─────────────────────────────────────────────────

export function JoinLiveForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await joinLiveAction(code);
          if (!r.ok) return setError(r.error);
          router.push(`/live/${r.runId}`);
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">Code from your tutor</label>
        <input id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoComplete="off" className={`${inputClasses} w-40 font-mono uppercase tracking-widest`} />
      </div>
      <Button type="submit" disabled={pending || code.trim().length < 6}>{pending ? "Joining…" : "Join"}</Button>
      {error && <Alert tone="error" className="basis-full">{error}</Alert>}
    </form>
  );
}
