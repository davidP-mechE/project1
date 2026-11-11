import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { ImportForm } from "@/components/bank/import-form";
import { requireUser } from "@/server/session";
import { canAuthor } from "@/server/bank";
import { DESMOS_TECHNIQUES, TEMPLATE_FIELDS } from "@/lib/bank/import";

export const metadata: Metadata = { title: "Import questions" };

export default async function ImportPage() {
  const user = await requireUser();
  if (!(await canAuthor(user.id))) notFound();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/bank" className="text-muted hover:underline">← Question bank</Link>
      </p>
      <PageHeader title="Import questions" description="A CSV or JSON file of original questions (the same format as the 1600 Project lesson files). You'll see every row and its problems before anything is imported. Good rows come in as drafts." />
      <Card className="flex flex-col gap-3 text-sm">
        <p>
          Templates: <a className="underline" href="/api/bank/template?format=csv">CSV</a> · <a className="underline" href="/api/bank/template?format=json">JSON</a>
        </p>
        <details>
          <summary className="cursor-pointer font-medium">Fields</summary>
          <p className="mt-2 text-muted">{TEMPLATE_FIELDS.join(", ")}. &quot;id&quot; works for external_id. Anything else in the file is ignored.</p>
          <ul className="mt-2 list-disc pl-5 text-muted">
            <li>type: mcq or grid-in. MCQ: choice_a to choice_d, and answer is the letter. Grid-in: answer is the value (3/4, 0.75…).</li>
            <li>distractor_notes: for MCQ, the mistake behind each wrong letter ({`{"A": "…"}`}); for grid-ins, each likely wrong value. In a CSV, write it as JSON text.</li>
            <li>skill: the skill&apos;s name (e.g. Linear equations in one variable). difficulty: 1, 2 or 3. section: math or rw.</li>
            <li>desmos_technique (optional): {DESMOS_TECHNIQUES.join(", ")}.</li>
            <li>source, if given, must be original. Official College Board questions can&apos;t be imported.</li>
          </ul>
        </details>
      </Card>
      <Card>
        <ImportForm />
      </Card>
    </div>
  );
}
