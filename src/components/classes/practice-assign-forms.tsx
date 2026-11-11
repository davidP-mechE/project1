"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { assignLogTestAction, assignQuestionSetAction } from "@/server/actions/classes";
import { TargetPicker, type TargetOptions, type TargetValue } from "./target-picker";

const dueIso = (local: string) => (local ? new Date(local).toISOString() : null);

/** "Log Practice Test N by <date>". */
export function AssignLogTestForm({ classId, tests, targetOptions }: { classId: string; tests: { id: string; name: string }[]; targetOptions: TargetOptions }) {
  const router = useRouter();
  const [testId, setTestId] = useState(tests[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [t, setT] = useState<TargetValue>({ groupIds: [], studentIds: [] });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignLogTestAction(classId, { testId, dueAt: dueIso(due), note, targets: t });
          setMsg(r.ok ? { tone: "success", text: "Assigned." } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Practice test
          <select className={inputClasses} value={testId} onChange={(e) => setTestId(e.target.value)}>
            {tests.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Log it by
          <input type="datetime-local" className={inputClasses} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Note (optional)
          <input className={inputClasses} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
      </div>
      <TargetPicker options={targetOptions} value={t} onChange={setT} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !testId}>Assign</Button>
      </div>
    </form>
  );
}

/** A published question set, with due date, optional time limit and the calculator setting. */
export function AssignSetForm({ classId, sets, targetOptions }: { classId: string; sets: { id: string; title: string; count: number }[]; targetOptions: TargetOptions }) {
  const router = useRouter();
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [limit, setLimit] = useState("");
  const [calculator, setCalculator] = useState<"ALLOWED" | "BY_HAND">("ALLOWED");
  const [t, setT] = useState<TargetValue>({ groupIds: [], studentIds: [] });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (sets.length === 0) return <p className="text-sm text-muted">No published sets yet. Publish one in the question bank (with &quot;Classes it&apos;s assigned to&quot; or &quot;Every student&quot;).</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignQuestionSetAction(classId, { setId, dueAt: dueIso(due), timeLimitMin: limit ? Number(limit) : null, calculator, targets: t });
          setMsg(r.ok ? { tone: "success", text: "Assigned." } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-3">
          Set
          <select className={inputClasses} value={setId} onChange={(e) => setSetId(e.target.value)}>
            {sets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} ({x.count} questions)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Due
          <input type="datetime-local" className={inputClasses} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Time limit (minutes, optional)
          <input type="number" min={1} max={300} className={inputClasses} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">Calculator</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name={`calc-${classId}`} checked={calculator === "ALLOWED"} onChange={() => setCalculator("ALLOWED")} /> Allowed (Desmos panel)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name={`calc-${classId}`} checked={calculator === "BY_HAND"} onChange={() => setCalculator("BY_HAND")} /> By hand only
          </label>
        </fieldset>
      </div>
      <TargetPicker options={targetOptions} value={t} onChange={setT} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !setId}>Assign</Button>
      </div>
    </form>
  );
}
