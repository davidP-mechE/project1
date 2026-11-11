"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmAllTagsAction, setItemTagsAction } from "@/server/actions/classes";
import { DOMAINS, domainById, SECTIONS } from "@/lib/sat/domains";
import { cn } from "@/lib/utils";

export type Tags = { domain: string | null; skill: string | null; difficulty: string | null; desmosSolvable: boolean; tagsConfirmed: boolean };

const DIFF: Record<string, string> = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };
const select = "h-9 rounded-lg border border-border bg-surface px-2 text-sm";

/** A question's SAT tags: shown as chips, with a small form to change or confirm them. */
export function TagEditor({ worksheetId, itemId, tags }: { worksheetId: string; itemId: string; tags: Tags }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(tags);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const d = domainById(tags.domain);
  const save = (t: Tags) =>
    start(async () => {
      const res = await setItemTagsAction(worksheetId, itemId, { domain: t.domain, skill: t.skill, difficulty: t.difficulty, desmosSolvable: t.desmosSolvable });
      if (!res.ok) return setError(res.error);
      setError(null);
      setOpen(false);
      router.refresh();
    });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={cn("rounded px-1.5 py-0.5 font-medium", d ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted")}>{d ? d.name : "No SAT subject"}</span>
        {tags.skill && <span className="rounded bg-surface-2 px-1.5 py-0.5">{tags.skill}</span>}
        {tags.difficulty && <span className="rounded bg-surface-2 px-1.5 py-0.5">{DIFF[tags.difficulty]}</span>}
        {tags.desmosSolvable && <span className="rounded bg-surface-2 px-1.5 py-0.5">Desmos helps</span>}
        {!tags.tagsConfirmed && <span className="rounded bg-warning-bg px-1.5 py-0.5 font-medium text-warning">Suggested by Claude</span>}
        {!tags.tagsConfirmed && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(tags)}>
            Confirm tags
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Change tags
        </Button>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }
  const dom = domainById(form.domain);
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">SAT tags</legend>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span>Subject</span>
          <select className={select} value={form.domain ?? ""} onChange={(e) => setForm({ ...form, domain: e.target.value || null, skill: null })}>
            <option value="">Not SAT / none</option>
            {SECTIONS.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {DOMAINS.filter((x) => x.section === s.id).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {dom && (
          <label className="flex flex-col gap-1 text-xs">
            <span>Skill</span>
            <select className={cn(select, "max-w-72")} value={form.skill ?? ""} onChange={(e) => setForm({ ...form, skill: e.target.value || null })}>
              <option value="">(none)</option>
              {dom.skills.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span>Difficulty</span>
          <select className={select} value={form.difficulty ?? ""} onChange={(e) => setForm({ ...form, difficulty: e.target.value || null })}>
            <option value="">(none)</option>
            {Object.entries(DIFF).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {dom?.section === "MATH" && (
          <label className="flex items-center gap-2 self-end pb-2 text-xs">
            <input type="checkbox" checked={form.desmosSolvable} onChange={(e) => setForm({ ...form, desmosSolvable: e.target.checked })} className="size-4 accent-[var(--primary)]" />
            Desmos helps
          </label>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => save(form)}>
          Save tags
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setForm(tags), setOpen(false))}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

export function ConfirmAllTagsButton({ worksheetId, count }: { worksheetId: string; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (count === 0) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await confirmAllTagsAction(worksheetId);
          router.refresh();
        })
      }
    >
      Confirm all {count} suggested tags
    </Button>
  );
}
