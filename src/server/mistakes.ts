import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { ClassError } from "./access";
import { DOMAINS, domainName } from "@/lib/sat/domains";
import { gridInMatches, nextReview } from "@/lib/sat/practice";
import { quickCheck } from "@/lib/grading/normalize";

/**
 * The mistake log: every wrong answer (worksheet assignments, diagnostics,
 * College Board questions, and misses entered from outside tests) comes back
 * for review on a schedule (1, 3, 7, 16 days) until it's answered right twice
 * in a row. Misses without a question of our own (outside tests) come back as
 * a similar question from the program's tagged bank, on the same skill.
 */

export type NewMistake = {
  sourceType: "ASSIGNMENT" | "DIAGNOSTIC" | "EXTERNAL" | "SCORE";
  sourceId: string;
  itemId?: string | null;
  externalUrl?: string | null;
  externalId?: string | null;
  section?: string | null;
  domain?: string | null;
  skill?: string | null;
  reason?: string | null;
  label: string;
};

/** Add wrong answers to the log (due tomorrow). A retired one that's missed again comes back. */
export async function addMistakes(studentId: string, items: NewMistake[], now = new Date()) {
  const due = new Date(now.getTime() + 86_400_000);
  for (const m of items) {
    await db.mistakeItem.upsert({
      where: { studentId_sourceType_sourceId: { studentId, sourceType: m.sourceType, sourceId: m.sourceId } },
      create: { studentId, ...m, due },
      update: { due, streak: 0, retiredAt: null, reason: m.reason ?? undefined },
    });
  }
}

/** The student's log: due now, coming up, and open mistakes by domain. */
export async function myMistakes(userId: string, now = new Date()) {
  const open = await db.mistakeItem.findMany({ where: { studentId: userId, retiredAt: null }, orderBy: { due: "asc" } });
  const [retired, recent] = await Promise.all([
    db.mistakeItem.count({ where: { studentId: userId, retiredAt: { not: null } } }),
    db.mistakeItem.count({ where: { studentId: userId } }),
  ]);
  const byDomain = DOMAINS.map((d) => ({ domain: d.id, name: d.name, open: open.filter((m) => m.domain === d.id).length })).filter((d) => d.open > 0);
  return { due: open.filter((m) => m.due <= now), upcoming: open.filter((m) => m.due > now), byDomain, retired, total: recent };
}

/** Open mistakes per domain for one student (staff see this on the student's page, after their own scope check). */
export async function openMistakesByDomain(studentId: string) {
  const open = await db.mistakeItem.groupBy({ by: ["domain"], where: { studentId, retiredAt: null }, _count: { _all: true } });
  return open.map((o) => ({ domain: o.domain, name: domainName(o.domain), open: o._count._all })).sort((a, b) => b.open - a.open);
}

/** The program staff's tagged questions on the same skill (or domain): used for misses without a question of our own. */
async function similarItem(studentId: string, m: { domain: string | null; skill: string | null; id: string; reviews: number; itemId: string | null }) {
  if (!m.domain) return null;
  const programs = await db.program.findMany({ where: { classes: { some: { members: { some: { userId: studentId } } } } }, select: { adminId: true, classes: { select: { staff: { select: { userId: true } } } } } });
  const owners = [...new Set(programs.flatMap((p) => [p.adminId, ...p.classes.flatMap((c) => c.staff.map((s) => s.userId))]))];
  if (!owners.length) return null;
  const base = { worksheet: { ownerId: { in: owners } }, archivedAt: null, tagsConfirmed: true, type: { in: ["MULTIPLE_CHOICE" as const, "SHORT_ANSWER" as const] }, id: { not: m.itemId ?? "" }, OR: [{ worksheet: { source: "UPLOAD" } }, { approvedAt: { not: null } }] };
  let pool = m.skill ? await db.worksheetItem.findMany({ where: { ...base, skill: m.skill }, select: { id: true }, orderBy: { id: "asc" }, take: 50 }) : [];
  if (!pool.length) pool = await db.worksheetItem.findMany({ where: { ...base, domain: m.domain }, select: { id: true }, orderBy: { id: "asc" }, take: 50 });
  if (!pool.length) return null;
  // A different question each review, stable within one review.
  let h = m.reviews;
  for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length].id;
}

/** What to practise for one mistake: the question itself (no answer key), a similar one, or a College Board link. */
export async function practiceFor(userId: string, mistakeId: string) {
  const m = await db.mistakeItem.findFirst({ where: { id: mistakeId, studentId: userId, retiredAt: null } });
  if (!m) throw new NotFoundError("Mistake not found");
  if (m.sourceType === "EXTERNAL") return { mistake: m, kind: "external" as const, url: m.externalUrl, questionId: m.externalId, question: null };
  const itemId = m.sourceType === "SCORE" ? await similarItem(userId, m) : m.itemId;
  const item = itemId ? await db.worksheetItem.findUnique({ where: { id: itemId }, select: { id: true, label: true, type: true, prompt: true, choices: true, section: true } }) : null;
  if (!item) return { mistake: m, kind: "self" as const, url: null, questionId: null, question: null };
  return { mistake: m, kind: "question" as const, url: null, questionId: null, question: { ...item, similar: item.id !== m.itemId } };
}

/** Answer a review. Questions are checked here; College Board retries and topic reviews are self-reported. */
export async function answerMistake(userId: string, mistakeId: string, input: { practiceItemId?: string; choice?: unknown; response?: unknown; selfReport?: unknown }, now = new Date()) {
  const p = await practiceFor(userId, mistakeId);
  let correct: boolean;
  let feedback: { correctChoice: number | null; answer: string; explanation: string } | null = null;
  if (p.kind === "question") {
    if (input.practiceItemId !== p.question!.id) throw new ClassError("That question changed. Reload and try again.", 409);
    const item = await db.worksheetItem.findUniqueOrThrow({ where: { id: p.question!.id } });
    if (item.type === "MULTIPLE_CHOICE") {
      if (typeof input.choice !== "number") throw new ClassError("Choose one of the options.");
      correct = input.choice === item.correctChoice;
    } else {
      if (typeof input.response !== "string" || !input.response.trim()) throw new ClassError("Enter an answer.");
      correct = gridInMatches(item.answer, input.response) || quickCheck(item.answer, input.response) === "correct";
    }
    feedback = { correctChoice: item.correctChoice, answer: item.answer, explanation: item.explanation };
  } else {
    if (input.selfReport !== "CORRECT" && input.selfReport !== "INCORRECT") throw new ClassError("Say how it went.");
    correct = input.selfReport === "CORRECT";
  }
  const next = nextReview(p.mistake.streak, correct, now);
  await db.mistakeItem.update({ where: { id: p.mistake.id }, data: { streak: next.streak, due: next.due, reviews: { increment: 1 }, retiredAt: next.retired ? now : null } });
  return { correct, retired: next.retired, due: next.due, feedback };
}
