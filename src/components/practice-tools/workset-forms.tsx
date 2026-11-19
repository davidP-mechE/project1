"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { TargetPicker, type TargetOptions, type TargetValue } from "@/components/classes/target-picker";
import { assignSetToClassesAction, assignWorksheetAction } from "@/server/actions/practice-tools";

const dueIso = (local: string) => (local ? new Date(local).toISOString() : null);

/** Class → Assign: a whole worksheet (every question on it) to the class, groups or chosen students. */
export function AssignWorksheetForm({ classId, worksheets, targetOptions }: { classId: string; worksheets: { id: string; title: string; count: number; needsApproval: boolean }[]; targetOptions: TargetOptions }) {
  const router = useRouter();
  const [worksheetId, setWorksheetId] = useState(worksheets[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [limit, setLimit] = useState("");
  const [t, setT] = useState<TargetValue>({ groupIds: [], studentIds: [] });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const w = useId();
  const ti = useId();
  const d = useId();
  const l = useId();
  if (!worksheets.length) return <p className="text-sm text-muted">No worksheets yet. Upload one under Teaching → Worksheets.</p>;
  const chosen = worksheets.find((x) => x.id === worksheetId);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignWorksheetAction(classId, { worksheetId, title: title || undefined, dueAt: dueIso(due), timeLimitMin: limit ? Number(limit) : null, targets: t });
          setMsg(r.ok ? { tone: "success", text: "Assigned." } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={w} className="text-sm font-medium">Worksheet</label>
          <select id={w} value={worksheetId} onChange={(e) => setWorksheetId(e.target.value)} className={inputClasses}>
            {worksheets.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.count} question{x.count === 1 ? "" : "s"})</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ti} className="text-sm font-medium">Title (optional)</label>
          <input id={ti} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={chosen?.title} className={inputClasses} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={d} className="text-sm font-medium">Due</label>
          <input id={d} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputClasses} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={l} className="text-sm font-medium">Time limit (minutes, optional)</label>
          <input id={l} type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(e.target.value)} className={inputClasses} />
        </div>
      </div>
      {chosen?.needsApproval && <Alert tone="warning">Some questions on this worksheet were drafted by AI and still need approval in the Review queue.</Alert>}
      <TargetPicker options={targetOptions} value={t} onChange={setT} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div><Button type="submit" disabled={pending || !worksheetId}>Assign the worksheet</Button></div>
    </form>
  );
}

/** Bank set page: send a published set to several of your classes at once. */
export function AssignSetToClassesForm({ setId, classes }: { setId: string; classes: { id: string; name: string }[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [calculator, setCalculator] = useState<"ALLOWED" | "BY_HAND">("ALLOWED");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const d = useId();
  if (!classes.length) return <p className="text-sm text-muted">You don&apos;t teach any classes yet.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignSetToClassesAction({ setId, classIds: picked, dueAt: dueIso(due), calculator });
          setMsg(r.ok ? { tone: "success", text: `Assigned to ${r.count} class${r.count === 1 ? "" : "es"}.` } : { tone: "error", text: r.error });
          if (r.ok) setPicked([]);
        });
      }}
    >
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <legend className="mb-1 font-medium">Classes</legend>
        {classes.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} /> {c.name}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={d} className="text-sm font-medium">Due</label>
          <input id={d} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${inputClasses} w-56`} />
        </div>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">Calculator</legend>
          <label className="flex items-center gap-2"><input type="radio" name={`calc-${setId}`} checked={calculator === "ALLOWED"} onChange={() => setCalculator("ALLOWED")} /> Allowed</label>
          <label className="flex items-center gap-2"><input type="radio" name={`calc-${setId}`} checked={calculator === "BY_HAND"} onChange={() => setCalculator("BY_HAND")} /> By hand only</label>
        </fieldset>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div><Button type="submit" disabled={pending || !picked.length}>Assign to {picked.length || ""} class{picked.length === 1 ? "" : "es"}</Button></div>
    </form>
  );
}
