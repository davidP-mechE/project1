import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { ReshuffleButton } from "@/components/studio/review-forms";
import { requireOwner } from "@/server/owner-guard";
import { studioSets } from "@/server/studio";

export const metadata: Metadata = { title: "Sets", robots: { index: false, follow: false } };

/** The courses' practice sets: size, difficulty mix and where each is used, with a reshuffle button. */
export default async function StudioSetsPage() {
  const owner = await requireOwner();
  const sets = await studioSets(owner.id);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/studio" className="text-muted hover:underline">← Course Studio</Link>
      </p>
      <PageHeader eyebrow="Owner only" title="Sets" description="Practice sets used in your courses. Reshuffle puts a set's questions in a new random order; students part-way through keep their answers." />
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Set</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Questions</th>
              <th scope="col" className="px-3 py-2 font-medium">Easy / Medium / Hard</th>
              <th scope="col" className="px-3 py-2 font-medium">Used in</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sets.map((s) => (
              <tr key={s.id} className="align-top">
                <td className="px-3 py-2">
                  <Link href={`/bank/sets/${s.id}`} className="font-medium hover:underline">{s.title}</Link>
                  <span className="block text-xs text-muted">
                    {[s.key, s.status === "published" ? "published" : "draft", s.audience === "in_house" ? "in-house" : null, s.source === "college_board" ? "College Board" : null].filter(Boolean).join(" · ")}
                    {s.missing ? ` · ${s.missing} missing from the bank` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.count}</td>
                <td className="px-3 py-2">
                  <DifficultyBar mix={s.mix} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {s.usedIn.length === 0 ? <span className="text-muted">Not in a lesson</span> : s.usedIn.map((u) => (
                    <Link key={u.lessonId} href={`/studio/lessons/${u.lessonId}`} className="block hover:underline">{u.label}</Link>
                  ))}
                </td>
                <td className="px-3 py-2 text-right">
                  <ReshuffleButton setId={s.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sets.length === 0 && <p className="p-4 text-sm text-muted">No sets yet. Add a question set to a lesson, or import the course packets.</p>}
      </Card>
    </div>
  );
}

function DifficultyBar({ mix }: { mix: { easy: number; medium: number; hard: number } }) {
  const total = mix.easy + mix.medium + mix.hard || 1;
  const parts = [
    { n: mix.easy, cls: "bg-success", label: "easy" },
    { n: mix.medium, cls: "bg-warning", label: "medium" },
    { n: mix.hard, cls: "bg-danger", label: "hard" },
  ];
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded-sm bg-surface-2" aria-hidden>
        {parts.map((p) => (
          <span key={p.label} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      <span className="text-xs tabular-nums">
        {mix.easy} / {mix.medium} / {mix.hard}
      </span>
    </div>
  );
}
