import "server-only";
import { db } from "./db";
import { canSeeContent, contentAccess, questionWhere } from "./in-house";
import { NotFoundError } from "./courses";
import { ClassError } from "./access";
import { BankError, requireAuthor, setQuestionStatus } from "./bank";
import { getQuestionAssignment } from "./classes";
import { notify } from "./notifications";
import { roleOf } from "./roles";
import { LETTERS } from "@/lib/bank/answers";

/**
 * "Report this question". Students flag a question they can see: a bank
 * question in the practice player (practice sets and assigned sets) or a
 * worksheet question in an assignment. One open report per student per
 * question (reporting again updates it), at most 20 a day each. The report
 * keeps the version they saw and their latest answer.
 *
 * Reviewers: bank questions go to question authors (owner and tutors), with
 * the question's author notified; worksheet questions go to the worksheet's
 * owner. Reports are anonymous to reviewers (no student names). Resolving
 * marks them fixed or "no change"; unpublishing a bank question resolves its
 * reports too.
 */

export const REPORT_REASONS = ["WRONG_KEY", "TYPO", "CONFUSING", "FIGURE_MISSING", "OTHER"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REASON_TEXT: Record<ReportReason, string> = { WRONG_KEY: "Wrong answer key", TYPO: "Typo", CONFUSING: "Confusing", FIGURE_MISSING: "Figure missing", OTHER: "Other" };

const PER_DAY = 20;

export type ReportTarget = { kind: "bank"; sessionId: string; questionId: string } | { kind: "item"; assignmentId: string; itemId: string };

export async function reportQuestion(userId: string, target: ReportTarget, input: { reason: string; note?: string | null }, now = new Date()) {
  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) throw new ClassError("Choose what's wrong.");
  const note = input.note?.trim().slice(0, 1000) || null;
  if ((await db.questionReport.count({ where: { reporterId: userId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } })) >= PER_DAY) throw new ClassError("You've sent a lot of reports today. Thanks! Try again tomorrow.");

  let data: { bankQuestionId?: string; questionVersion?: number; worksheetItemId?: string; assignmentId?: string; answerGiven: string | null };
  let notifyIds: string[] = [];
  let label = "";
  if (target.kind === "bank") {
    // The student's own sitting of a set that contains the question.
    const s = await db.practiceSession.findUnique({ where: { id: target.sessionId }, select: { userId: true, assignmentId: true, set: { select: { questionIds: true } } } });
    if (!s || s.userId !== userId || !s.set.questionIds.includes(target.questionId)) throw new NotFoundError("Not found");
    const q = await db.bankQuestion.findUnique({ where: { id: target.questionId }, select: { id: true, version: true, authorId: true, externalId: true, source: true, audience: true } });
    if (!q || !canSeeContent(await contentAccess(userId), q)) throw new NotFoundError("Not found");
    const last = await db.bankAttempt.findFirst({ where: { userId, questionId: q.id }, orderBy: { createdAt: "desc" }, select: { answerGiven: true } });
    data = { bankQuestionId: q.id, questionVersion: q.version, assignmentId: s.assignmentId ?? undefined, answerGiven: last?.answerGiven ?? null };
    notifyIds = q.authorId ? [q.authorId] : (await db.user.findMany({ where: { role: "OWNER" }, select: { id: true } })).map((u) => u.id);
    label = q.externalId ?? "a bank question";
  } else {
    const a = await getQuestionAssignment(userId, target.assignmentId, now); // the student's own assignment (checks they're assigned it)
    const q = a.questions.find((x) => x.id === target.itemId);
    if (!q) throw new NotFoundError("Not found");
    const item = await db.worksheetItem.findUniqueOrThrow({ where: { id: q.id }, select: { worksheet: { select: { ownerId: true, title: true } } } });
    const given = q.mine ? (q.mine.choice !== null && q.mine.choice !== undefined ? LETTERS[q.mine.choice] ?? String(q.mine.choice) : q.mine.response || null) : null;
    data = { worksheetItemId: q.id, assignmentId: a.id, answerGiven: given };
    notifyIds = [item.worksheet.ownerId];
    label = `question ${q.label} of ${item.worksheet.title}`;
  }
  const where = { reporterId: userId, status: "OPEN", ...(data.bankQuestionId ? { bankQuestionId: data.bankQuestionId } : { worksheetItemId: data.worksheetItemId }) };
  const existing = await db.questionReport.findFirst({ where, select: { id: true } });
  const row = existing
    ? await db.questionReport.update({ where: { id: existing.id }, data: { reason: input.reason, note, answerGiven: data.answerGiven, questionVersion: data.questionVersion } })
    : await db.questionReport.create({ data: { reporterId: userId, reason: input.reason, note, ...data } });
  const key = `report:${data.bankQuestionId ?? data.worksheetItemId}`;
  await notify(notifyIds.filter((id) => id !== userId), { kind: "review", key, title: `A student reported ${label}: ${REASON_TEXT[input.reason as ReportReason].toLowerCase()}`, href: "/teach/question-reports" }, now);
  return row;
}

/** The review queue: reports grouped by question. Authors see bank questions; anyone sees reports on their own worksheets. */
export async function reportQueue(userId: string, opts: { resolved?: boolean } = {}) {
  const role = await roleOf(userId);
  const status = opts.resolved ? "RESOLVED" : "OPEN";
  const [bank, items] = await Promise.all([
    role.isAuthor
      ? db.questionReport.findMany({ where: { status, bankQuestionId: { not: null }, bankQuestion: questionWhere(await contentAccess(userId)) }, orderBy: { createdAt: "desc" }, take: 500, include: { bankQuestion: { select: { id: true, externalId: true, stem: true, choices: true, answer: true, type: true, version: true, status: true, authorId: true, author: { select: { name: true } } } } } })
      : [],
    db.questionReport.findMany({ where: { status, worksheetItem: { worksheet: { ownerId: userId } } }, orderBy: { createdAt: "desc" }, take: 500, include: { worksheetItem: { select: { id: true, label: true, prompt: true, choices: true, correctChoice: true, answer: true, worksheet: { select: { id: true, title: true } } } } } }),
  ]);
  type Group = { key: string; kind: "bank" | "item"; title: string; stem: string; choices: string[]; answer: string; version: number | null; published: boolean | null; editHref: string; canUnpublish: boolean; reports: { id: string; reason: ReportReason; note: string | null; answerGiven: string | null; version: number | null; createdAt: Date; resolution: string | null }[] };
  const groups = new Map<string, Group>();
  const push = (g: Omit<Group, "reports">, r: (typeof bank)[number] | (typeof items)[number]) => {
    const cur = groups.get(g.key) ?? { ...g, reports: [] };
    cur.reports.push({ id: r.id, reason: r.reason as ReportReason, note: r.note, answerGiven: r.answerGiven, version: r.questionVersion, createdAt: r.createdAt, resolution: r.resolution });
    groups.set(g.key, cur);
  };
  for (const r of bank) {
    const q = r.bankQuestion!;
    push({ key: `bank:${q.id}`, kind: "bank", title: `${q.externalId ?? "Bank question"}${q.author ? ` · by ${q.author.name}` : ""}`, stem: q.stem, choices: q.choices, answer: q.answer, version: q.version, published: q.status === "published", editHref: `/bank/${q.id}`, canUnpublish: q.status === "published" && (role.isOwner || q.authorId === userId) }, r);
  }
  for (const r of items) {
    const i = r.worksheetItem!;
    push({ key: `item:${i.id}`, kind: "item", title: `${i.worksheet.title}, question ${i.label}`, stem: i.prompt, choices: i.choices, answer: i.correctChoice !== null ? (LETTERS[i.correctChoice] ?? "") : i.answer, version: null, published: null, editHref: `/teach/worksheets/${i.worksheet.id}`, canUnpublish: false }, r);
  }
  return [...groups.values()].sort((a, b) => b.reports.length - a.reports.length || b.reports[0].createdAt.getTime() - a.reports[0].createdAt.getTime());
}

export async function openReportCount(userId: string) {
  const role = await roleOf(userId);
  const visible = questionWhere(await contentAccess(userId));
  return db.questionReport.count({ where: { status: "OPEN", OR: [...(role.isAuthor ? [{ bankQuestionId: { not: null }, bankQuestion: visible }] : []), { worksheetItem: { worksheet: { ownerId: userId } } }] } });
}

/** Check the reviewer may act on this question's reports. */
async function reviewable(userId: string, key: string) {
  const [kind, id] = key.split(":");
  if (kind === "bank") {
    await requireAuthor(userId);
    if (!(await db.bankQuestion.count({ where: { AND: [{ id }, questionWhere(await contentAccess(userId))] } }))) throw new NotFoundError("Not found");
    return { bankQuestionId: id };
  }
  if (kind === "item") {
    const ok = await db.worksheetItem.count({ where: { id, worksheet: { ownerId: userId } } });
    if (!ok) throw new NotFoundError("Not found");
    return { worksheetItemId: id };
  }
  throw new NotFoundError("Not found");
}

export async function resolveReports(userId: string, key: string, resolution: "FIXED" | "NO_CHANGE", now = new Date()) {
  if (resolution !== "FIXED" && resolution !== "NO_CHANGE") throw new ClassError("Choose fixed or no change.");
  const where = await reviewable(userId, key);
  const r = await db.questionReport.updateMany({ where: { ...where, status: "OPEN" }, data: { status: "RESOLVED", resolution, resolvedById: userId, resolvedAt: now } });
  return { resolved: r.count };
}

/** Unpublish a reported bank question (its author, or the owner) and resolve its reports. */
export async function unpublishReported(userId: string, key: string, now = new Date()) {
  const where = await reviewable(userId, key);
  if (!where.bankQuestionId) throw new ClassError("Only bank questions can be unpublished here. Edit the worksheet instead.");
  try {
    await setQuestionStatus(userId, where.bankQuestionId, "draft");
  } catch (err) {
    if (err instanceof BankError) throw new ClassError(err.message, err.status === 403 ? 403 : 400);
    throw err;
  }
  const r = await db.questionReport.updateMany({ where: { ...where, status: "OPEN" }, data: { status: "RESOLVED", resolution: "UNPUBLISHED", resolvedById: userId, resolvedAt: now } });
  return { resolved: r.count };
}
