import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { PracticePlayer, type PlayerState } from "@/components/bank/practice-player";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { practiceState } from "@/server/bank";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Practice" };

export default async function PlayPage({ params }: PageProps<"/practice/play/[sessionId]">) {
  const user = await requireUser();
  const { sessionId } = await params;
  let s;
  try {
    s = await practiceState(user.id, sessionId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const state = JSON.parse(JSON.stringify(s)) as PlayerState;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href={s.assignmentId ? "/classes" : "/practice"} className="text-muted hover:underline">← {s.assignmentId ? "Classes" : "Practice sets"}</Link>
      </p>
      <PageHeader title={s.title} />
      <PracticePlayer state={state} desmosKey={env.DESMOS_API_KEY ?? null} />
    </div>
  );
}
