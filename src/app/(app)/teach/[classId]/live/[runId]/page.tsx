import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { StaffLiveScreen } from "@/components/practice-tools/live";
import { NotFoundError } from "@/server/courses";
import { KIND_LABEL, staffLiveView } from "@/server/live";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Live run" };

/** The staff screen for one live run: the join code and answers as they arrive. */
export default async function LiveRunPage({ params }: PageProps<"/teach/[classId]/live/[runId]">) {
  const user = await requireUser();
  const { classId, runId } = await params;
  let v;
  try {
    v = await staffLiveView(user.id, runId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (v.run.classId !== classId) notFound();
  const { access, ...initial } = v;
  void access;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/${classId}/live`} className="text-muted hover:text-text hover:underline">← {v.run.className}: live runs</Link>
      </p>
      <PageHeader title={`${KIND_LABEL[v.run.kind]}: ${v.run.title}`} description="Updates every few seconds." />
      <StaffLiveScreen initial={JSON.parse(JSON.stringify(initial))} />
    </div>
  );
}
