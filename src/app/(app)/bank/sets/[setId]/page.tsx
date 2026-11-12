import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { SetEditor } from "@/components/bank/set-forms";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { getSetForAuthor } from "@/server/bank";

export const metadata: Metadata = { title: "Question set" };

export default async function SetPage({ params }: PageProps<"/bank/sets/[setId]">) {
  const user = await requireUser();
  const { setId } = await params;
  let set;
  try {
    set = await getSetForAuthor(user.id, setId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/bank/sets" className="text-muted hover:underline">← Question sets</Link>
      </p>
      <PageHeader title={set.title} description={`${set.status === "published" ? "Published" : "Draft"} · ${set.questions.length} questions${set.author ? ` · by ${set.author.name}` : ""}`} />
      <Card>
        <SetEditor key={set.updatedAt.toISOString()} set={{ id: set.id, title: set.title, description: set.description, visibility: set.visibility, status: set.status, timeLimitMin: set.timeLimitMin, questions: set.questions }} />
      </Card>
    </div>
  );
}
