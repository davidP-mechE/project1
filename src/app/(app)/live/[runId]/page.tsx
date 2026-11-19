import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { StudentLiveScreen } from "@/components/practice-tools/live";
import { NotFoundError } from "@/server/courses";
import { KIND_LABEL, studentLiveView } from "@/server/live";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Live warm-up" };

/** A student's live run: answer each question once; answers appear when the tutor reveals them. */
export default async function StudentLivePage({ params }: PageProps<"/live/[runId]">) {
  const user = await requireUser();
  const { runId } = await params;
  let v;
  try {
    v = await studentLiveView(user.id, runId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={`${KIND_LABEL[v.run.kind]}: ${v.run.title}`} description={v.run.className} />
      <StudentLiveScreen initial={v} />
    </div>
  );
}
