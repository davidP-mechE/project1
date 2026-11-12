import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { RedoStatus } from "@/components/tracker/redo-status";
import { requireUser } from "@/server/session";
import { redoList } from "@/server/insights";
import { trackerOptions } from "@/server/tracker";

export const metadata: Metadata = { title: "Redo list" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Every question missed, skipped or guessed on a logged test, to redo in Bluebook and mark off. */
export default async function RedoPage({ searchParams }: PageProps<"/practice-tests/redo">) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = { skillId: one(sp.skill), errorTypeId: one(sp.error), status: one(sp.status) };
  const [rows, opts] = await Promise.all([redoList(user.id, f), trackerOptions()]);
  const qs = new URLSearchParams(Object.entries({ skill: f.skillId, error: f.errorTypeId, status: f.status }).filter(([, v]) => v));
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/practice-tests" className="text-muted hover:underline">← SAT practice log</Link>
      </p>
      <PageHeader title="Redo list" description="Every question you got wrong, skipped or guessed on a logged test. Redo it in Bluebook (by test, module and number), then mark how it went." actions={<a href={`/api/practice-tests/redo?${qs}`} className={buttonClasses("secondary", "sm")}>Export CSV</a>} />
      <Card>
        <form className="grid gap-3 sm:grid-cols-4" aria-label="Filter the redo list">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Skill
            <select name="skill" defaultValue={f.skillId} className={inputClasses}>
              <option value="">Any</option>
              {opts.skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Error type
            <select name="error" defaultValue={f.errorTypeId} className={inputClasses}>
              <option value="">Any</option>
              {opts.errorTypes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Status
            <select name="status" defaultValue={f.status} className={inputClasses}>
              <option value="">Any</option>
              <option value="to_redo">To redo</option>
              <option value="redone_correct">Redone (correct)</option>
              <option value="still_wrong">Still wrong</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className={buttonClasses("secondary", "sm")}>Filter</button>
            <Link href="/practice-tests/redo" className="text-sm text-muted hover:underline">Clear</Link>
          </div>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="Nothing to redo">Questions you mark wrong, skipped or guessed on a logged test show up here.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const label = `${r.attempt.test.name}, ${r.section === "rw" ? "R&W" : "Math"} module ${r.module}, question ${r.questionNumber}`;
            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="font-semibold">
                      {r.attempt.test.name} · {r.section === "rw" ? "R&W" : "Math"} M{r.module} #{r.questionNumber}
                    </p>
                    <p className="text-sm text-muted">
                      {r.result} · {r.skill?.name ?? "no skill"} · {r.errorType?.label ?? "no error type"}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </div>
                  <RedoStatus itemId={r.id} status={r.redoStatus} label={label} />
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
