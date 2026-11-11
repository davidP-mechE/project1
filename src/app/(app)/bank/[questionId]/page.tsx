import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { QuestionEditor, type EditorRecord } from "@/components/bank/question-editor";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { getBankQuestion, skillOptions, toRecord } from "@/server/bank";

export const metadata: Metadata = { title: "Edit question" };

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
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/bank" className="text-muted hover:underline">← Question bank</Link>
      </p>
      <PageHeader
        title={q.externalId ? `Question ${q.externalId}` : "Question"}
        description={`${q.status === "published" ? "Published" : "Draft"} · version ${q.version} · ${q._count.attempts} answer${q._count.attempts === 1 ? "" : "s"} so far · by ${q.author?.name ?? "the 1600 Project"} · source: original`}
      />
      <QuestionEditor
        key={`${q.id}:${q.version}:${q.updatedAt.toISOString()}`}
        questionId={q.id}
        initial={record}
        status={q.status}
        version={q.version}
        skills={await skillOptions()}
      />
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
