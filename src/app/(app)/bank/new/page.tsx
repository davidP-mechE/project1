import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { EMPTY_RECORD, QuestionEditor } from "@/components/bank/question-editor";
import { requireUser } from "@/server/session";
import { canAuthor, skillOptions } from "@/server/bank";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage() {
  const user = await requireUser();
  if (!(await canAuthor(user.id))) notFound();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/bank" className="text-muted hover:underline">← Question bank</Link>
      </p>
      <PageHeader title="New question" description="An original question. It stays a draft until you publish it." />
      <QuestionEditor questionId={null} initial={EMPTY_RECORD} status="draft" version={1} skills={await skillOptions()} />
    </div>
  );
}
