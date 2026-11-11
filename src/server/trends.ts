import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { classAccess, studentIdsInScope, type ClassAccess } from "./access";
import { DOMAINS, domainName } from "@/lib/sat/domains";

/**
 * Comparison charts for staff: groups over time, domains over time, and (for
 * the program admin) classes and teachers side by side. Every number is an
 * average over students the viewer may see, in subjects they cover. Nothing
 * names or ranks individual students.
 */

export type Series = { name: string; values: (number | null)[]; counts: number[] };
const MONTHS = 12;

/** The last 12 month keys ("2026-01"), oldest first. */
export function lastMonths(now = new Date(), n = MONTHS) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Which score a subject-limited viewer sees: their section's, or the total. */
function metricFor(a: ClassAccess): "total" | "math" | "rw" {
  if (!a.subjects) return "total";
  const sections = new Set(DOMAINS.filter((d) => a.subjects!.has(d.id)).map((d) => d.section));
  return sections.size === 1 ? (sections.has("MATH") ? "math" : "rw") : "total";
}

function average(months: string[], rows: { month: string; v: number }[]): Pick<Series, "values" | "counts"> {
  const acc = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const t = acc.get(r.month) ?? { n: 0, sum: 0 };
    t.n += 1;
    t.sum += r.v;
    acc.set(r.month, t);
  }
  return { values: months.map((m) => (acc.get(m) ? Math.round(acc.get(m)!.sum / acc.get(m)!.n) : null)), counts: months.map((m) => acc.get(m)?.n ?? 0) };
}

async function scoreRows(studentIds: string[], since: Date, metric: "total" | "math" | "rw") {
  if (!studentIds.length) return [];
  const rows = await db.scoreRecord.findMany({ where: { studentId: { in: studentIds }, takenOn: { gte: since } }, select: { studentId: true, takenOn: true, total: true, math: true, rw: true } });
  return rows.flatMap((r) => {
    const v = metric === "total" ? r.total : r[metric];
    return v === null ? [] : [{ studentId: r.studentId, month: monthOf(r.takenOn), v }];
  });
}

/** Accuracy (0–100) per domain per month, over these students' answers. */
async function domainRows(studentIds: string[], since: Date) {
  if (!studentIds.length) return [];
  const [assignment, diagnostic, external] = await Promise.all([
    db.assignmentAnswer.findMany({ where: { userId: { in: studentIds }, createdAt: { gte: since }, item: { domain: { not: null } } }, select: { score: true, createdAt: true, item: { select: { domain: true } } } }),
    db.diagnosticAnswer.findMany({ where: { attempt: { userId: { in: studentIds } }, updatedAt: { gte: since } }, select: { correct: true, updatedAt: true, itemId: true } }),
    db.externalResult.findMany({ where: { userId: { in: studentIds }, createdAt: { gte: since }, result: { not: "SKIPPED" } }, select: { result: true, createdAt: true, itemKey: true, assignment: { select: { externalItems: true } } } }),
  ]);
  const diagItems = new Map((await db.worksheetItem.findMany({ where: { id: { in: [...new Set(diagnostic.map((d) => d.itemId))] } }, select: { id: true, domain: true } })).map((i) => [i.id, i.domain]));
  const out: { domain: string; month: string; v: number }[] = [];
  for (const a of assignment) if (a.item.domain) out.push({ domain: a.item.domain, month: monthOf(a.createdAt), v: a.score * 100 });
  for (const d of diagnostic) {
    const dom = diagItems.get(d.itemId);
    if (dom) out.push({ domain: dom, month: monthOf(d.updatedAt), v: d.correct ? 100 : 0 });
  }
  for (const e of external) {
    const items = Array.isArray(e.assignment.externalItems) ? (e.assignment.externalItems as { key: string; domain: string }[]) : [];
    const dom = items.find((i) => i.key === e.itemKey)?.domain;
    if (dom) out.push({ domain: dom, month: monthOf(e.createdAt), v: e.result === "CORRECT" ? 100 : 0 });
  }
  return out;
}

/** A class's trends, as this person may see them. */
export async function classTrends(userId: string, classId: string, now = new Date()) {
  const a = await classAccess(userId, classId, "view");
  const months = lastMonths(now);
  const since = new Date(`${months[0]}-01T00:00:00Z`);
  const inScope = new Set(await studentIdsInScope(a));
  const metric = metricFor(a);
  const groups = await db.classGroup.findMany({ where: { classId, ...(a.groupIds.length ? { id: { in: a.groupIds } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, members: { select: { userId: true } } } });
  const scores = await scoreRows([...inScope], since, metric);
  const groupSeries: Series[] = [{ name: a.groupIds.length ? "Your students" : "Whole class", ...average(months, scores) }];
  for (const g of groups) {
    const ids = new Set(g.members.map((m) => m.userId).filter((id) => inScope.has(id)));
    groupSeries.push({ name: g.name, ...average(months, scores.filter((s) => ids.has(s.studentId))) });
  }
  const answers = await domainRows([...inScope], since);
  const domains = DOMAINS.filter((d) => !a.subjects || a.subjects.has(d.id));
  const domainSeries: Series[] = domains.map((d) => ({ name: domainName(d.id), ...average(months, answers.filter((x) => x.domain === d.id)) }));
  return { access: a, months, metric, groups: groupSeries, domains: domainSeries };
}

/** Program-wide comparisons for its admin: classes over time, and each teacher's average gain. */
export async function programTrends(userId: string, programId: string, now = new Date()) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: userId }, select: { id: true, name: true } });
  // Like the program dashboard: anyone but the admin gets "not found".
  if (!p) throw new NotFoundError("Program not found");
  const months = lastMonths(now);
  const since = new Date(`${months[0]}-01T00:00:00Z`);
  const classes = await db.class.findMany({
    where: { programId, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, members: { select: { userId: true } }, staff: { where: { role: "TEACHER" }, select: { user: { select: { id: true, name: true } } } } },
  });
  const all = [...new Set(classes.flatMap((c) => c.members.map((m) => m.userId)))];
  const scores = await scoreRows(all, since, "total");
  const classSeries: Series[] = classes.map((c) => {
    const ids = new Set(c.members.map((m) => m.userId));
    return { name: c.name, ...average(months, scores.filter((s) => ids.has(s.studentId))) };
  });
  // Gain per student: latest score minus baseline, over all time.
  const records = await db.scoreRecord.findMany({ where: { studentId: { in: all } }, orderBy: { takenOn: "asc" }, select: { studentId: true, total: true, isBaseline: true } });
  const gain = new Map<string, number>();
  const byStudent = new Map<string, typeof records>();
  for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  for (const [id, rs] of byStudent) {
    if (rs.length < 2) continue;
    const base = rs.find((r) => r.isBaseline) ?? rs[0];
    gain.set(id, rs.at(-1)!.total - base.total);
  }
  const teachers = new Map<string, { name: string; students: Set<string> }>();
  for (const c of classes) {
    for (const s of c.staff) {
      const t = teachers.get(s.user.id) ?? { name: s.user.name, students: new Set<string>() };
      for (const m of c.members) t.students.add(m.userId);
      teachers.set(s.user.id, t);
    }
  }
  const teacherBars = [...teachers.values()]
    .map((t) => {
      const gains = [...t.students].flatMap((s) => (gain.has(s) ? [gain.get(s)!] : []));
      return { label: t.name, value: gains.length ? Math.round(gains.reduce((x, y) => x + y, 0) / gains.length) : null, n: gains.length };
    })
    .sort((x, y) => x.label.localeCompare(y.label));
  return { program: p, months, classes: classSeries, teachers: teacherBars };
}

/** Accuracy per domain (0–100) over these students' answers in the last `days` days, in the given subjects (null = all). */
export async function domainAccuracyFor(studentIds: string[], subjects: Set<string> | null, days = 90, now = new Date()) {
  const rows = await domainRows(studentIds, new Date(now.getTime() - days * 86_400_000));
  return DOMAINS.filter((d) => !subjects || subjects.has(d.id)).map((d) => {
    const mine = rows.filter((r) => r.domain === d.id);
    return { domain: d.id, name: domainName(d.id), answers: mine.length, accuracy: mine.length ? Math.round(mine.reduce((s, r) => s + r.v, 0) / mine.length) : null };
  });
}
