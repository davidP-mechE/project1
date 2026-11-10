import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { classAccess, ClassError } from "./access";
import { DOMAINS, isDomain, scopeCovers } from "@/lib/sat/domains";
import { addMistakes } from "./mistakes";
import { cleanTargets, isAssignedToStudent, type Targets } from "./targets";

/**
 * Official College Board practice, by link only. A tutor attaches College
 * Board Student Question Bank questions to an assignment by their link and
 * question ID (with the domain, for reports). Students open each one on the
 * College Board site and record how it went here. No question content is ever
 * copied or stored: there are no fields for it, and unknown fields are refused.
 */

export const EXTERNAL_MAX = 60;

export type ExternalItem = { key: string; questionId: string; url: string; section: "MATH" | "RW"; domain: string };

/** Only links to the College Board's own sites. */
export function isCollegeBoardUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "collegeboard.org" || u.hostname.endsWith(".collegeboard.org"));
  } catch {
    return false;
  }
}

const ItemInput = z
  .object({
    questionId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,24}$/, "A question ID is letters and numbers, like a1b2c3d4."),
    url: z.string().trim().max(500).refine(isCollegeBoardUrl, "Links must go to the College Board's site (collegeboard.org)."),
    domain: z.string().refine(isDomain, "Choose the question's SAT domain."),
  })
  .strict();

const ResultInput = z
  .object({
    result: z.enum(["CORRECT", "INCORRECT", "SKIPPED"]),
    reason: z.enum(["CARELESS", "CONCEPT", "TIME", "GUESS"]).nullable().optional(),
    timeSec: z.number().int().min(0).max(3600).nullable().optional(),
  })
  .strict();

function cleanItems(raw: unknown): ExternalItem[] {
  const parsed = z.array(ItemInput).min(1, "Add at least one question.").max(EXTERNAL_MAX, `Up to ${EXTERNAL_MAX} questions per assignment.`).safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Please check the questions.";
    throw new ClassError(/Unrecognized/i.test(msg) ? "Only a link, question ID and domain can be saved, never the question itself." : msg);
  }
  const seen = new Set<string>();
  return parsed.data.map((i) => {
    if (seen.has(i.questionId.toLowerCase())) throw new ClassError(`Question ${i.questionId} is listed twice.`);
    seen.add(i.questionId.toLowerCase());
    return { key: randomUUID().slice(0, 8), questionId: i.questionId, url: i.url, domain: i.domain, section: DOMAINS.find((d) => d.id === i.domain)!.section };
  });
}

/** Assign College Board questions (by link) to a class; the subject follows their domains and must be in the caller's scope. */
export async function assignExternal(userId: string, classId: string, input: { title: string; items: unknown; note?: string; dueAt?: string | null; targets?: Partial<Targets> }) {
  const access = await classAccess(userId, classId, "teach");
  const targets = await cleanTargets(access, input.targets);
  const items = cleanItems(input.items);
  const sections = new Set(items.map((i) => i.section));
  const work = { section: sections.size === 1 ? [...sections][0] : null, domains: [...new Set(items.map((i) => i.domain))] };
  if (!scopeCovers(access.subjects, work)) throw new ClassError("Some of those questions are outside the subjects you cover in this class.", 403);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new ClassError("Give the assignment a title.");
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new ClassError("That due date isn't valid.");
  return db.assignment.create({
    data: { classId, kind: "EXTERNAL", title, note: input.note?.trim().slice(0, 2000) || null, dueAt, externalItems: items as unknown as Prisma.InputJsonValue, section: work.section, domains: work.domains, ...targets },
  });
}

export const externalItemsOf = (a: { externalItems: Prisma.JsonValue }) => (Array.isArray(a.externalItems) ? (a.externalItems as unknown as ExternalItem[]) : []);

/** A student's view: the questions (links) and what they've recorded. */
export async function getExternalAssignment(userId: string, assignmentId: string) {
  const a = await db.assignment.findFirst({ where: { id: assignmentId, kind: "EXTERNAL", class: { members: { some: { userId } }, archivedAt: null } }, include: { class: { select: { id: true, name: true } } } });
  if (!a || !(await isAssignedToStudent(a, userId))) throw new NotFoundError("Assignment not found");
  const results = await db.externalResult.findMany({ where: { assignmentId, userId } });
  const mine = new Map(results.map((r) => [r.itemKey, r]));
  return {
    assignment: { id: a.id, title: a.title, note: a.note, dueAt: a.dueAt, className: a.class.name },
    items: externalItemsOf(a).map((i, n) => ({ ...i, number: n + 1, result: mine.get(i.key) ?? null })),
  };
}

/** The student records how a College Board question went (the latest entry counts). */
export async function recordExternal(userId: string, assignmentId: string, itemKey: string, raw: unknown) {
  const a = await db.assignment.findFirst({ where: { id: assignmentId, kind: "EXTERNAL", class: { members: { some: { userId } }, archivedAt: null } }, select: { externalItems: true, classId: true, groupIds: true, studentIds: true } });
  if (!a || !(await isAssignedToStudent(a, userId))) throw new NotFoundError("Assignment not found");
  if (!externalItemsOf(a).some((i) => i.key === itemKey)) throw new NotFoundError("Question not found");
  const parsed = ResultInput.safeParse(raw);
  if (!parsed.success) throw new ClassError("Choose correct, incorrect or skipped.");
  const data = { result: parsed.data.result, reason: parsed.data.result === "INCORRECT" ? (parsed.data.reason ?? null) : null, timeSec: parsed.data.timeSec ?? null };
  await db.externalResult.upsert({ where: { assignmentId_userId_itemKey: { assignmentId, userId, itemKey } }, create: { assignmentId, userId, itemKey, ...data }, update: { ...data, createdAt: new Date() } });
  if (data.result === "INCORRECT") {
    const item = externalItemsOf(a).find((i) => i.key === itemKey)!;
    await addMistakes(userId, [{ sourceType: "EXTERNAL", sourceId: `${assignmentId}:${itemKey}`, externalUrl: item.url, externalId: item.questionId, section: item.section, domain: item.domain, reason: data.reason, label: `College Board question ${item.questionId}` }]);
  }
}
