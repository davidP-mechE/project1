"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { removeProgramAccessRuleAction, setProgramAccessRuleAction } from "@/server/actions/staff";

type Rule = { id: string; email: string; mode: "ONLY" | "BLOCKED"; note: string | null; createdAt: string };

/** The program page's access rules: limit an email to this program, or block it from it. */
export function ProgramAccessRules({ programId, programName, rules }: { programId: string; programName: string; rules: Rule[] }) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          start(async () => {
            const r = await setProgramAccessRuleAction(programId, { email: String(f.get("email") ?? ""), mode: String(f.get("mode") ?? ""), note: String(f.get("note") ?? "") || undefined });
            setStatus(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            if (r.ok) form.reset();
          });
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <input name="email" type="email" required maxLength={254} placeholder="student@example.com" className={inputClasses} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Rule
          <select name="mode" required defaultValue="ONLY" className={inputClasses}>
            <option value="ONLY">Only {programName}</option>
            <option value="BLOCKED">Blocked from {programName}</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save rule"}
        </Button>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-3">
          Note (optional, only admins see it)
          <input name="note" maxLength={200} className={inputClasses} />
        </label>
        <p role="status" className={`text-sm sm:col-span-3 ${status?.ok === false ? "text-danger" : "text-muted"}`}>
          {status?.text ?? ""}
        </p>
      </form>
      {rules.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border-[1.5px] border-border text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="font-medium">{r.email}</span>{" "}
                <span className={r.mode === "ONLY" ? "rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold" : "rounded bg-danger-bg px-1.5 py-0.5 text-xs font-semibold text-danger"}>
                  {r.mode === "ONLY" ? `Only ${programName}` : `Blocked from ${programName}`}
                </span>
                {r.note && <span className="block text-xs text-muted">{r.note}</span>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await removeProgramAccessRuleAction(programId, r.id);
                    setStatus(res.ok ? { ok: true, text: `Removed the rule for ${r.email}.` } : { ok: false, text: res.error });
                  })
                }
              >
                Remove<span className="sr-only"> the rule for {r.email}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
