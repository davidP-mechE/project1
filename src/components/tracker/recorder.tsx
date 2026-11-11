"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { completeAttemptAction, deleteAttemptAction, saveAttemptAction } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";

type Section = "rw" | "math";
type Result = "correct" | "wrong" | "skipped" | "guessed";
export type RecorderModule = { section: Section; number: number; question_count: number };
export type RecorderItem = { section: Section; module: number; questionNumber: number; result: Result; skillId: string | null; errorTypeId: string | null; note: string | null };
export type RecorderData = {
  id: string;
  testName: string;
  status: "draft" | "complete";
  dateTaken: string;
  scoreRw: number | null;
  scoreMath: number | null;
  total: number | null;
  minutesUsed: number | null;
  notes: string | null;
  modules: RecorderModule[];
  items: RecorderItem[];
};
type Skill = { id: string; section: string; domain: string; name: string };
type ErrorType = { id: string; label: string };

const NEXT: Record<Result, Result> = { correct: "wrong", wrong: "skipped", skipped: "guessed", guessed: "correct" };
const GLYPH: Record<Result, string> = { correct: "", wrong: "✗", skipped: "–", guessed: "?" };
const LABEL: Record<Result, string> = { correct: "Correct", wrong: "Wrong", skipped: "Skipped", guessed: "Guessed" };
const CELL: Record<Result, string> = {
  correct: "border-border bg-surface text-text",
  wrong: "border-danger bg-danger-bg text-danger",
  skipped: "border-warning bg-warning-bg text-warning",
  guessed: "border-focus bg-surface-2 text-text",
};
const key = (s: Section, m: number, n: number) => `${s}-${m}-${n}`;
const modName = (m: { section: Section; number: number }) => `${m.section === "rw" ? "R&W" : "Math"} ${m.number}`;

/**
 * Log an official practice test: every question starts as correct; tap a
 * number to cycle wrong → skipped → guessed → correct. Only the misses need
 * tagging (skill, error type, optional note). Everything autosaves.
 */
export function Recorder({ data, skills, errorTypes }: { data: RecorderData; skills: Skill[]; errorTypes: ErrorType[] }) {
  const router = useRouter();
  const [details, setDetails] = useState({
    dateTaken: data.dateTaken.slice(0, 10),
    scoreRw: data.scoreRw?.toString() ?? "",
    scoreMath: data.scoreMath?.toString() ?? "",
    total: data.total?.toString() ?? "",
    minutesUsed: data.minutesUsed?.toString() ?? "",
    notes: data.notes ?? "",
  });
  const [items, setItems] = useState<Map<string, RecorderItem>>(() => new Map(data.items.filter((i) => i.result !== "correct").map((i) => [key(i.section, i.module, i.questionNumber), i])));
  const [tab, setTab] = useState(0);
  const [status, setStatus] = useState(data.status);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [changes, setChanges] = useState(0);
  const first = useRef(true);

  const touch = () => setChanges((c) => c + 1);
  const bothSections = details.scoreRw !== "" && details.scoreMath !== "";
  const autoTotal = bothSections ? String(Number(details.scoreRw) + Number(details.scoreMath)) : details.total;

  // Autosave a moment after the last change.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setSave({ state: "saving" });
      const r = await saveAttemptAction(data.id, {
        dateTaken: details.dateTaken,
        scoreRw: details.scoreRw || null,
        scoreMath: details.scoreMath || null,
        total: bothSections ? null : details.total || null,
        minutesUsed: details.minutesUsed || null,
        notes: details.notes,
        items: [...items.values()],
      });
      if (r.ok) {
        setSave({ state: "saved" });
        setStatus(r.status);
      } else setSave({ state: "error", message: r.error });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes]);

  const cycle = (m: RecorderModule, n: number) => {
    const k = key(m.section, m.number, n);
    const cur = items.get(k);
    const next = NEXT[cur?.result ?? "correct"];
    const copy = new Map(items);
    if (next === "correct") copy.delete(k);
    else copy.set(k, { section: m.section, module: m.number, questionNumber: n, result: next, skillId: cur?.skillId ?? null, errorTypeId: cur?.errorTypeId ?? (next === "guessed" ? "guessed" : null), note: cur?.note ?? null });
    setItems(copy);
    touch();
  };
  const tag = (k: string, patch: Partial<RecorderItem>) => {
    const cur = items.get(k);
    if (!cur) return;
    setItems(new Map(items).set(k, { ...cur, ...patch }));
    touch();
  };

  const misses = useMemo(() => [...items.values()].sort((a, b) => (a.section === b.section ? a.module - b.module || a.questionNumber - b.questionNumber : a.section === "rw" ? -1 : 1)), [items]);
  const untagged = misses.filter((i) => !i.skillId || !i.errorTypeId).length;
  const m = data.modules[tab];
  const countIn = (mod: RecorderModule) => misses.filter((i) => i.section === mod.section && i.module === mod.number).length;

  const finish = () =>
    start(async () => {
      setProblem(null);
      // Make sure the latest edits are saved first.
      const s = await saveAttemptAction(data.id, { dateTaken: details.dateTaken, scoreRw: details.scoreRw || null, scoreMath: details.scoreMath || null, total: bothSections ? null : details.total || null, minutesUsed: details.minutesUsed || null, notes: details.notes, items: [...items.values()] });
      if (!s.ok) return setProblem(s.error);
      const r = await completeAttemptAction(data.id);
      if (!r.ok) return setProblem(r.error);
      setStatus("complete");
      router.push("/practice-tests/insights");
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="sticky top-14 z-10 -mx-1 self-end rounded-md bg-surface px-2 py-1 text-xs text-muted shadow-sm" aria-live="polite">
        {save.state === "saving" ? "Saving…" : save.state === "saved" ? "All changes saved" : save.state === "error" ? <span className="text-danger">Not saved: {save.message}</span> : status === "complete" ? "Complete" : "Draft · saves as you go"}
      </p>

      <Card className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <label className="col-span-2 flex flex-col gap-1 text-sm font-medium">
          Date taken
          <input type="date" className={inputClasses} value={details.dateTaken} onChange={(e) => (setDetails({ ...details, dateTaken: e.target.value }), touch())} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          R&amp;W score
          <input inputMode="numeric" className={inputClasses} value={details.scoreRw} placeholder="200–800" onChange={(e) => (setDetails({ ...details, scoreRw: e.target.value.replace(/\D/g, "").slice(0, 3) }), touch())} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Math score
          <input inputMode="numeric" className={inputClasses} value={details.scoreMath} placeholder="200–800" onChange={(e) => (setDetails({ ...details, scoreMath: e.target.value.replace(/\D/g, "").slice(0, 3) }), touch())} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Total
          <input inputMode="numeric" className={inputClasses} value={autoTotal} readOnly={bothSections} placeholder="400–1600" onChange={(e) => (setDetails({ ...details, total: e.target.value.replace(/\D/g, "").slice(0, 4) }), touch())} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Minutes used
          <input inputMode="numeric" className={inputClasses} value={details.minutesUsed} onChange={(e) => (setDetails({ ...details, minutesUsed: e.target.value.replace(/\D/g, "").slice(0, 3) }), touch())} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm font-medium sm:col-span-6">
          Notes (optional)
          <input className={inputClasses} value={details.notes} maxLength={2000} onChange={(e) => (setDetails({ ...details, notes: e.target.value }), touch())} placeholder="How it went, what to work on" />
        </label>
      </Card>

      <Card className="flex flex-col gap-3">
        <div role="tablist" aria-label="Modules" className="flex gap-1 overflow-x-auto">
          {data.modules.map((mod, n) => (
            <button
              key={modName(mod)}
              role="tab"
              type="button"
              aria-selected={n === tab}
              onClick={() => setTab(n)}
              className={cn("h-10 shrink-0 rounded-md border px-3 text-sm font-semibold", n === tab ? "border-focus bg-surface-2" : "border-border")}
            >
              {modName(mod)}
              {countIn(mod) > 0 && <span className="ml-1 text-xs text-danger">({countIn(mod)})</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">Tap a question to cycle: wrong ✗ → skipped – → guessed ? → correct. Everything else counts as correct.</p>
        <div role="tabpanel" aria-label={`${modName(m)}, ${m.question_count} questions`} className="grid grid-cols-6 gap-1.5 min-[380px]:grid-cols-7 sm:grid-cols-11">
          {Array.from({ length: m.question_count }, (_, i) => i + 1).map((n) => {
            const r = items.get(key(m.section, m.number, n))?.result ?? "correct";
            return (
              <button
                key={n}
                type="button"
                onClick={() => cycle(m, n)}
                aria-label={`Question ${n}: ${LABEL[r]}`}
                className={cn("relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-md border-[1.5px] text-sm font-semibold tabular-nums", CELL[r])}
              >
                {n}
                {r !== "correct" && <span aria-hidden className="text-[0.7rem] leading-none">{GLYPH[r]}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Tag your misses {misses.length > 0 && <span className="text-sm font-normal text-muted">({misses.length - untagged} of {misses.length} tagged)</span>}
        </h2>
        {misses.length === 0 ? (
          <p className="text-sm text-muted">No misses marked yet. Tap the questions you got wrong, skipped or guessed above.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {misses.map((i) => (
              <MissRow key={key(i.section, i.module, i.questionNumber)} item={i} skills={skills.filter((s) => s.section === i.section)} errorTypes={errorTypes} onChange={(p) => tag(key(i.section, i.module, i.questionNumber), p)} />
            ))}
          </ul>
        )}
      </Card>

      {problem && <Alert tone="error">{problem}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={finish} disabled={pending}>{status === "complete" ? "Save and view insights" : "Finish log"}</Button>
        <Button
          variant="danger"
          className="ml-auto"
          disabled={pending}
          onClick={() =>
            confirm("Delete this log?") &&
            start(async () => {
              const r = await deleteAttemptAction(data.id);
              if (!r.ok) return setProblem(r.error);
              router.push("/practice-tests");
            })
          }
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function MissRow({ item, skills, errorTypes, onChange }: { item: RecorderItem; skills: Skill[]; errorTypes: ErrorType[]; onChange: (p: Partial<RecorderItem>) => void }) {
  const [filter, setFilter] = useState("");
  const shown = filter.trim() ? skills.filter((s) => `${s.domain} ${s.name}`.toLowerCase().includes(filter.trim().toLowerCase())) : skills;
  const domains = [...new Set(shown.map((s) => s.domain))];
  const label = `${item.section === "rw" ? "R&W" : "Math"} M${item.module} #${item.questionNumber}`;
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border-[1.5px] p-3", item.skillId && item.errorTypeId ? "border-border" : "border-warning")}>
      <p className="text-sm font-semibold">
        {label} · <span className={item.result === "wrong" ? "text-danger" : "text-muted"}>{LABEL[item.result]}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <input className={inputClasses} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search skills" aria-label={`Search skills for ${label}`} />
        <select className={inputClasses} value={item.skillId ?? ""} onChange={(e) => onChange({ skillId: e.target.value || null })} aria-label={`Skill for ${label}`}>
          <option value="">Skill…</option>
          {domains.map((d) => (
            <optgroup key={d} label={d}>
              {shown
                .filter((s) => s.domain === d)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {item.skillId && !shown.some((s) => s.id === item.skillId) && <option value={item.skillId}>{skills.find((s) => s.id === item.skillId)?.name ?? "Chosen skill"}</option>}
        </select>
      </div>
      <div role="radiogroup" aria-label={`Error type for ${label}`} className="flex flex-wrap gap-1.5">
        {errorTypes.map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={item.errorTypeId === e.id}
            onClick={() => onChange({ errorTypeId: e.id })}
            className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", item.errorTypeId === e.id ? "border-focus bg-text text-bg" : "border-border bg-surface")}
          >
            {e.label}
          </button>
        ))}
      </div>
      <input className={inputClasses} value={item.note ?? ""} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} placeholder="Note (optional)" aria-label={`Note for ${label}`} />
    </li>
  );
}
