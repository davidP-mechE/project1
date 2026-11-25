import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { listBank, skillOptions } from "@/server/bank";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Question bank" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const plain = (s: string) => s.replace(/\$+/g, "").replace(/[|#*_`>-]{2,}/g, " ").replace(/\s+/g, " ").trim();

/** The question bank (owner and approved tutors only; everyone else gets a 404). */
export default async function BankPage({ searchParams }: PageProps<"/bank">) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = {
    section: one(sp.section),
    skillId: one(sp.skill),
    week: Number(one(sp.week)) || undefined,
    difficulty: Number(one(sp.difficulty)) || undefined,
    type: one(sp.type),
    status: one(sp.status),
    q: one(sp.q),
    page: Number(one(sp.page)) || 1,
    flagged: one(sp.flagged) === "1",
    sort: (["attempts", "pct", "time", "reports", "flags"] as const).find((x) => x === one(sp.sort)),
    dir: one(sp.dir) === "asc" ? ("asc" as const) : ("desc" as const),
  };
  let data, skills;
  try {
    [data, skills] = await Promise.all([listBank(user.id, f), skillOptions()]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const qs = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const all = { section: f.section, skill: f.skillId, week: f.week ?? "", difficulty: f.difficulty ?? "", type: f.type, status: f.status, q: f.q, flagged: f.flagged ? "1" : "", sort: f.sort ?? "", dir: f.sort ? f.dir : "", ...patch };
    for (const [k, v] of Object.entries(all)) if (v !== "" && v !== undefined) p.set(k, String(v));
    return `/bank?${p}`;
  };
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        eyebrow="The 1600 Project"
        title="Question bank"
        description="Original questions only. Students see published questions inside published sets; never the bank itself."
        actions={
          <>
            <ButtonLink href="/bank/new" size="sm">New question</ButtonLink>
            <ButtonLink href="/bank/import" size="sm" variant="secondary">Import</ButtonLink>
            <ButtonLink href="/bank/college-board" size="sm" variant="secondary">College Board</ButtonLink>
            <ButtonLink href="/bank/sets" size="sm" variant="secondary">Sets</ButtonLink>
          </>
        }
      />
      <Card>
        <form className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" role="search" aria-label="Filter questions">
          <label className="col-span-2 flex flex-col gap-1 text-xs font-medium lg:col-span-2">
            Search stems or ids
            <input name="q" defaultValue={f.q} className={inputClasses} placeholder="e.g. y-intercept or W3-25" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Section
            <select name="section" defaultValue={f.section} className={inputClasses}>
              <option value="">Any</option>
              <option value="math">Math</option>
              <option value="rw">R&amp;W</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs font-medium">
            Skill
            <select name="skill" defaultValue={f.skillId} className={inputClasses}>
              <option value="">Any</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.section === "math" ? "Math" : "R&W"} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Week
            <input name="week" type="number" min={0} max={99} defaultValue={f.week ?? ""} className={inputClasses} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Difficulty
            <select name="difficulty" defaultValue={f.difficulty ?? ""} className={inputClasses}>
              <option value="">Any</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Type
            <select name="type" defaultValue={f.type} className={inputClasses}>
              <option value="">Any</option>
              <option value="mcq">Multiple choice</option>
              <option value="grid_in">Grid-in</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Status
            <select name="status" defaultValue={f.status} className={inputClasses}>
              <option value="">Any</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" name="flagged" value="1" defaultChecked={f.flagged} /> Likely bad only
          </label>
          {f.sort && <input type="hidden" name="sort" value={f.sort} />}
          {f.sort && <input type="hidden" name="dir" value={f.dir} />}
          <div className="col-span-2 flex items-end gap-2 sm:col-span-4 lg:col-span-8">
            <button className={buttonClasses("secondary", "sm")} type="submit">Filter</button>
            <Link href="/bank" className="text-sm text-muted hover:underline">Clear</Link>
            <span className="ml-auto text-sm text-muted">{data.total} question{data.total === 1 ? "" : "s"}</span>
          </div>
        </form>
      </Card>
      {data.rows.length === 0 ? (
        <EmptyState title="No questions match" action={<ButtonLink href="/bank/new">Write a question</ButtonLink>}>
          Try fewer filters, or import a file.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Questions, with answers on their current version</caption>
            <thead className="bg-surface-2 text-left text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Id</th>
                <th scope="col" className="px-3 py-2 font-semibold">Question</th>
                {(
                  [
                    ["attempts", "Answers"],
                    ["pct", "% correct"],
                    ["time", "Avg time"],
                    ["reports", "Reports"],
                    ["flags", "Flags"],
                  ] as const
                ).map(([key, label]) => {
                  const active = f.sort === key;
                  const next = active && f.dir === "desc" ? "asc" : "desc";
                  return (
                    <th key={key} scope="col" aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2 text-right font-semibold">
                      <Link href={qs({ sort: key, dir: next, page: 1 })} className="underline-offset-2 hover:underline">
                        {label}
                        <span aria-hidden>{active ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</span>
                        <span className="sr-only">, sort {next === "asc" ? "lowest" : "highest"} first</span>
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((q) => {
                const c = q.stats.current;
                return (
                  <tr key={q.id} className="border-t border-border align-top hover:bg-surface-2">
                    <td className="px-3 py-2 font-mono text-xs text-muted">{q.externalId ?? "–"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/bank/${q.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{plain(q.stem).slice(0, 110) || (q.imageIsQuestion ? `Image question${q.skill ? ` · ${q.skill.name}` : ""}` : "(no text)")}</Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>{q.skill?.name ?? "No skill"}</span>
                        <span>· D{q.difficulty}</span>
                        <span>· {q.type === "mcq" ? "MCQ" : "Grid-in"}</span>
                        {q.version > 1 && <span>· v{q.version}</span>}
                        <span className={cn("rounded px-1.5 py-0.5 font-semibold", q.status === "published" ? "bg-success-bg text-success" : "bg-surface-2")}>{q.status}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.attempts}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.pct === null ? "–" : `${Math.round(c.pct * 100)}%`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.avgSeconds === null ? "–" : `${c.avgSeconds}s`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{q.stats.openReports || "–"}</td>
                    <td className="px-3 py-2 text-right">{q.stats.flags.length ? <span className="rounded bg-warning-bg px-1.5 py-0.5 text-xs font-semibold text-warning" title={q.stats.flags.map((x) => x.text).join(" ")}>⚑ {q.stats.flags.length}<span className="sr-only"> likely problem{q.stats.flags.length === 1 ? "" : "s"}</span></span> : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-3 text-sm">
          {data.page > 1 && <Link href={qs({ page: data.page - 1 })} className="underline">Previous</Link>}
          <span className="text-muted">Page {data.page} of {data.pages}</span>
          {data.page < data.pages && <Link href={qs({ page: data.page + 1 })} className="underline">Next</Link>}
        </nav>
      )}
    </div>
  );
}
