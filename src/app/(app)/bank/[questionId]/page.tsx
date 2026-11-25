import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Markdown } from "@/components/lesson/markdown";
import { QuestionStatsCard } from "@/components/question-quality/stats-card";
import { questionStats } from "@/server/question-stats";
import { QuestionEditor, type EditorRecord } from "@/components/bank/question-editor";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { getBankQuestion, skillOptions, toRecord } from "@/server/bank";
import { env } from "@/server/env";
import { QuestionDesmosEditor } from "@/components/desmos/question-desmos-editor";

export const metadata: Metadata = { title: "Edit question" };

/** Imported Question Bank items (and anything you can't edit): shown as students see them, read-only. */
function ImportedQuestion({ q }: { q: Awaited<ReturnType<typeof getBankQuestion>> }) {
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {q.audience === "in_house" ? "In-house · " : ""}
        {q.sourceDetail ?? (q.source === "college_board" ? "College Board" : "Original")} · {q.skill?.name ?? "No skill"} · answer {q.answer.split("|").join(", ")}
        {q.canEdit ? "" : " · read-only"}
      </p>
      {q.imageIsQuestion && q.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.imageUrl} alt={q.imageAlt || "The question"} className="h-auto max-w-full rounded border border-border bg-white" />
      ) : (
        <>
          <Markdown>{q.stem}</Markdown>
          {q.choices.length > 0 && (
            <ol className="list-[upper-alpha] pl-6 text-sm">
              {q.choices.map((c, i) => (
                <li key={i}>
                  <Markdown>{c}</Markdown>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <h2 className="text-sm font-semibold">Explanation</h2>
      {q.rationaleImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.rationaleImageUrl} alt="Explanation of the answer" className="h-auto max-w-full rounded border border-border bg-white" />
      ) : (
        <Markdown>{q.explanation}</Markdown>
      )}
      {q.imageIsQuestion && <p className="text-xs text-muted">Imported from the Question Bank: to change it, edit the bank file and run npm run import:bank again.</p>}
    </Card>
  );
}

export default async function EditQuestionPage({ params }: PageProps<"/bank/[questionId]">) {
  const user = await requireUser();
  const { questionId } = await params;
  let q;
  try {
    q = await getBankQuestion(user.id, questionId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const record = toRecord(q) as unknown as EditorRecord;
  const stats = await questionStats(user.id, q.id);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/bank" className="text-muted hover:underline">← Question bank</Link>
      </p>
      <PageHeader
        title={q.externalId ? `Question ${q.externalId}` : "Question"}
        description={`${q.status === "published" ? "Published" : "Draft"} · version ${q.version} · ${q._count.attempts} answer${q._count.attempts === 1 ? "" : "s"} so far · by ${q.author?.name ?? "the 1600 Project"} · source: ${q.source === "college_board" ? "College Board" : "original"}`}
      />
      {stats && <QuestionStatsCard stats={stats} type={q.type} answer={q.answer} />}
      {q.imageIsQuestion || q.rationaleImageUrl || !q.canEdit ? (
        <ImportedQuestion q={q} />
      ) : (
      <QuestionEditor
        key={`${q.id}:${q.version}:${q.updatedAt.toISOString()}`}
        questionId={q.id}
        initial={record}
        status={q.status}
        version={q.version}
        skills={await skillOptions()}
        desmosSlot={q.section === "math" ? <QuestionDesmosEditor questionId={q.id} apiKey={env.DESMOS_API_KEY ?? null} initialState={(q.desmosState as object | null) ?? null} /> : undefined}
      />
      )}
      {q.versions.length > 0 && (
        <details className="rounded-lg border border-border bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-medium">Earlier versions ({q.versions.length})</summary>
          <ul className="mt-2 list-disc pl-5 text-muted">
            {q.versions.map((v) => (
              <li key={v.version}>
                Version {v.version}, replaced {v.createdAt.toISOString().slice(0, 10)}. Answers given to it stay attached to it.
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
