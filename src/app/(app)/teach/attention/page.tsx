import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { AttentionActions, ReopenButton } from "@/components/attention/attention-actions";
import { NotFoundError } from "@/server/courses";
import { attentionList, REASON_LABEL, REASONS, type AttentionReason } from "@/server/attention";
import { listTeaching } from "@/server/classes";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Needs attention" };

const TONE: Record<AttentionReason, string> = {
  PACE: "bg-danger-bg text-danger",
  ACCURACY: "bg-danger-bg text-danger",
  WORK: "bg-warning-bg text-warning",
  SKILL: "bg-warning-bg text-warning",
  INACTIVE: "bg-surface-2 text-text",
};

/** One ranked to-do list across every class and student in the viewer's scope. */
export default async function AttentionPage({ searchParams }: PageProps<"/teach/attention">) {
  const user = await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const classId = one(sp.class);
  const reason = REASONS.find((r) => r === one(sp.reason));
  const mine = sp.mine === "1";
  const showHidden = sp.hidden === "1";
  const showAll = sp.all === "1";
  let list;
  try {
    list = await attentionList(user.id, { classId, reason, mine, includeHidden: showHidden });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const [classes, zone] = await Promise.all([listTeaching(user.id), viewerZone()]);
  const filtered = Boolean(classId || reason || mine);
  // The most urgent first; long lists show the top 25 until asked for all.
  const LIMIT = 25;
  const shown = showAll ? list.items : list.items.slice(0, LIMIT);
  const allHref = `/teach/attention?${new URLSearchParams({ ...(classId ? { class: classId } : {}), ...(reason ? { reason } : {}), ...(mine ? { mine: "1" } : {}), ...(showHidden ? { hidden: "1" } : {}), all: "1" })}`;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Needs attention"
        description="Students in your classes and scope who may need a nudge, most urgent first: missed or late work, accuracy dropping, no login or practice, the same skill missed again and again, and score estimates below target pace. Worked out fresh each time you open this page."
      />
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter the list">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-class" className="text-sm font-medium">Class</label>
          <select id="f-class" name="class" defaultValue={classId ?? ""} className={`${inputClasses} w-56`}>
            <option value="">All my classes</option>
            {classes.filter((c) => !c.archivedAt).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-reason" className="text-sm font-medium">Reason</label>
          <select id="f-reason" name="reason" defaultValue={reason ?? ""} className={`${inputClasses} w-52`}>
            <option value="">Every reason</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>{REASON_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> My caseload only
        </label>
        <button type="submit" className={buttonClasses("secondary", "md")}>Filter</button>
        {filtered && <Link href="/teach/attention" className="h-10 content-center text-sm text-muted hover:underline">Clear</Link>}
      </form>
      {list.items.length === 0 ? (
        <EmptyState title={filtered ? "Nothing matches" : "Nobody needs attention right now"}>
          {list.students === 0 ? "Students in your classes will show here when something needs a look." : `All ${list.students} student${list.students === 1 ? " is" : "s are"} on track${filtered ? " for these filters" : ""}.`}
          {list.hiddenCount > 0 && !showHidden && (
            <>
              {" "}
              <Link href="/teach/attention?hidden=1" className="underline">{list.hiddenCount} handled or snoozed</Link>.
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted" role="status">
            {list.items.length} item{list.items.length === 1 ? "" : "s"} for {new Set(list.items.map((i) => i.studentId)).size} student{new Set(list.items.map((i) => i.studentId)).size === 1 ? "" : "s"}.
            {list.hiddenCount > 0 &&
              (showHidden ? (
                <> Showing handled and snoozed items too. <Link href="/teach/attention" className="underline">Hide them</Link>.</>
              ) : (
                <> {list.hiddenCount} handled or snoozed: <Link href="/teach/attention?hidden=1" className="underline">show</Link>.</>
              ))}
          </p>
          <ol className="flex flex-col gap-3">
            {shown.map((i, n) => (
              <li key={i.key}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold text-muted tabular-nums" aria-hidden>{n + 1}.</span>
                    <h2 className="text-lg font-semibold">
                      <Link href={`/teach/${i.classId}/students/${i.studentId}`} className="text-primary underline-offset-2 hover:underline">{i.name}</Link>
                    </h2>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${TONE[i.reason]}`}>{REASON_LABEL[i.reason]}</span>
                    <span className="text-sm text-muted">{i.className}</span>
                    {i.tutorId === user.id && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold">Your caseload</span>}
                  </div>
                  <p className="text-sm">{i.detail}</p>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    {i.numbers.map((x) => (
                      <div key={x.label} className="flex gap-1.5">
                        <dt className="text-muted">{x.label}:</dt>
                        <dd className="font-semibold tabular-nums">{x.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {i.hidden ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      {i.hidden.action === "SNOOZED" && i.hidden.until ? `Snoozed until ${formatInZone(i.hidden.until, zone, "dayTime")}.` : "Marked handled. It comes back if something new happens."}
                      {i.canAct && <ReopenButton item={{ classId: i.classId, studentId: i.studentId, reason: i.reason }} />}
                    </div>
                  ) : i.canAct ? (
                    <AttentionActions item={{ classId: i.classId, studentId: i.studentId, name: i.name, reason: i.reason, skill: i.skill }} />
                  ) : (
                    <p className="text-xs text-muted">Viewers can see this list but not act on it.</p>
                  )}
                </Card>
              </li>
            ))}
          </ol>
          {shown.length < list.items.length && (
            <Link href={allHref} className="self-start text-sm font-medium text-primary underline-offset-2 hover:underline">
              Show all {list.items.length} items
            </Link>
          )}
        </>
      )}
    </div>
  );
}
