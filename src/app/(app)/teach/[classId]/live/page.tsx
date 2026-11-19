import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { StartLiveForm } from "@/components/practice-tools/live";
import { NotFoundError } from "@/server/courses";
import { can } from "@/server/access";
import { getClassForTeacher } from "@/server/classes";
import { classLiveRuns, KIND_LABEL, liveStartOptions, type LiveKind } from "@/server/live";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Live warm-ups" };

/** Start a live warm-up or exit ticket, and see past runs. */
export default async function LivePage({ params }: PageProps<"/teach/[classId]/live">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, r;
  try {
    [c, r] = await Promise.all([getClassForTeacher(user.id, classId), classLiveRuns(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const zone = await viewerZone();
  const teach = can(r.access, "teach");
  const { sets, sessions, groups } = teach ? await liveStartOptions(user.id, classId) : { sets: [], sessions: [], groups: [] };
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="live" />
      {teach && (
        <Card>
          <h1 className="mb-1 text-xl font-semibold">Start a live warm-up or exit ticket</h1>
          <p className="mb-4 text-sm text-muted">Run a short published set during a session. Students join from Today or with a code, and you see answers come in. They only see the answer and explanation when you reveal it. Answers count toward each student&apos;s practice.</p>
          <StartLiveForm classId={classId} sets={sets} sessions={sessions.map((s) => ({ id: s.id, label: `${s.title ?? "Session"} · ${formatInZone(s.startsAt, zone, "full")}` }))} groups={groups} />
        </Card>
      )}
      {r.runs.length === 0 ? (
        <EmptyState title="No live runs yet">Runs you start appear here, with their results.</EmptyState>
      ) : (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Runs</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {r.runs.map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <Link href={`/teach/${classId}/live/${x.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{KIND_LABEL[x.kind as LiveKind] ?? "Live"}: {x.set.title}</Link>
                <span className={x.status === "OPEN" ? "font-semibold text-success" : "text-muted"}>{x.status === "OPEN" ? `Open · code ${x.code}` : "Closed"}</span>
                <span className="text-muted">{formatInZone(x.createdAt, zone, "full")} · {x._count.answers} answer{x._count.answers === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
