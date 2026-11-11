import "server-only";
import { z } from "zod";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { classAccess, ClassError, can } from "./access";
import { audit } from "./programs";
import { recordUsage } from "./usage";
import { assertAiBudget, LimitError } from "./limits";
import { rateLimit } from "./rate-limit";
import { getAssistant, type AssistantModel } from "./ai/assistant";
import { AiError } from "./ai/writer";
import { DOMAINS, isDomain, domainName } from "@/lib/sat/domains";
import { SAT_TEMPLATE, scheduleUnits, shiftUnits } from "@/lib/sat/calendar";
import { stalling } from "@/lib/sat/scores";
import { RATE_RULES } from "@/lib/usage/rate-limit";

/**
 * A class's curriculum mapped onto the school calendar. Teachers paste their
 * syllabus (Claude turns it into units: Sonnet, once per class) or start from
 * the built-in SAT template (no AI). Units are drafts until a teacher
 * publishes; students only ever see the published plan. Pacing suggestions are
 * decided by fixed rules; Claude (Haiku) only words them.
 */

const UnitsSchema = z.object({
  units: z.array(z.object({ title: z.string(), domains: z.array(z.string()), skills: z.array(z.string()), weeks: z.number().int(), notes: z.string() })),
});

const IMPORT_PROMPT = `You turn a tutor's SAT prep syllabus into curriculum units for a tutoring program's calendar.
Return the units in teaching order. For each: a short title; the digital SAT domains it covers, as ids from this list (empty for review, practice tests or orientation):
${DOMAINS.map((d) => `- ${d.id}: ${d.name}`).join("\n")}
the skills it covers (names from the official SAT skill list where they fit); how many school weeks it takes (1–6); and one or two sentences of notes for the teacher.
Only use what the syllabus says. If it gives dates or weeks, keep its pacing. If it isn't a syllabus, return an empty list.`;

/** The school calendar for a class's program (term start and closed days). */
async function calendarFor(classId: string) {
  const c = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { program: { select: { termStart: true, termEnd: true, closedDates: true } } } });
  return c.program;
}

export async function getCurriculum(userId: string, classId: string) {
  const access = await classAccess(userId, classId);
  const cur = await db.curriculum.findFirst({ where: { classId }, orderBy: { createdAt: "desc" }, include: { units: { orderBy: { order: "asc" } } } });
  const cal = await calendarFor(classId);
  return { access, curriculum: cur, calendar: cal, canEdit: can(access, "manageClass") || access.role === "SPECIALIST" };
}

/** Start a curriculum from pasted text (Claude reads it) or from the default SAT template (no AI). Replaces any draft. */
export async function importCurriculum(userId: string, classId: string, input: { text?: string; template?: boolean; title?: string }, deps: { ai?: AssistantModel } = {}, now = new Date()) {
  const access = await classAccess(userId, classId, "manageClass");
  let units: { title: string; domains: string[]; skills: string[]; weeks: number; notes: string }[];
  const text = input.text?.trim() ?? "";
  if (input.template) {
    units = SAT_TEMPLATE.map((u) => ({ ...u, skills: [] }));
  } else {
    if (text.length < 40) throw new ClassError("Paste your syllabus (or start from the SAT template).");
    if (text.length > 30_000) throw new ClassError("That's too long. Paste the outline part of your syllabus (under 30,000 characters).");
    const limited = await rateLimit(RATE_RULES.aiDraft, userId);
    if (!limited.ok) throw new ClassError("You've used the assistant a lot today. Please try again tomorrow.", 429);
    await assertAiBudget(userId).catch((err) => {
      throw err instanceof LimitError ? new ClassError(err.message, 429) : err;
    });
    const ai = deps.ai ?? getAssistant();
    try {
      const r = await ai.structured({ tier: "main", system: IMPORT_PROMPT, user: `<syllabus>\n${text}\n</syllabus>`, schema: UnitsSchema, maxTokens: 6000, demo: () => ({ units: SAT_TEMPLATE.map((u) => ({ ...u, skills: [] })) }) });
      await recordUsage({ userId, feature: "CURRICULUM" }, r.calls);
      units = r.value.units;
    } catch (err) {
      if (err instanceof AiError) {
        await recordUsage({ userId, feature: "CURRICULUM" }, err.calls);
        throw new ClassError(err.userMessage, 503);
      }
      throw err;
    }
    if (!units.length) throw new ClassError("Claude couldn't find units in that text. Check it's your syllabus, or start from the SAT template.");
  }
  const cleaned = units.slice(0, 40).map((u) => {
    const domains = [...new Set(u.domains.filter(isDomain))];
    const skills = u.skills.filter((s) => DOMAINS.some((d) => domains.includes(d.id) && d.skills.includes(s)));
    return { title: u.title.trim().slice(0, 120) || "Unit", domains, skills, weeks: Math.min(6, Math.max(1, Math.round(u.weeks))), notes: u.notes.trim().slice(0, 1000) };
  });
  const cal = await calendarFor(classId);
  const placed = scheduleUnits(cleaned, cal.termStart && cal.termStart > now ? cal.termStart : now, cal.closedDates);
  return db.$transaction(async (tx) => {
    await tx.curriculum.deleteMany({ where: { classId, status: "DRAFT" } });
    const cur = await tx.curriculum.create({
      data: {
        classId,
        title: input.title?.trim().slice(0, 120) || (input.template ? "SAT plan" : "Curriculum"),
        sourceText: input.template ? "" : text,
        createdById: userId,
        units: { create: placed.map((u, order) => ({ order, title: u.title, domains: u.domains, skills: u.skills, startsOn: u.startsOn, endsOn: u.endsOn, notes: u.notes })) },
      },
    });
    await audit(tx, { programId: access.programId, actorId: userId, action: "curriculum.import", targetType: "class", targetId: classId, summary: `Started a curriculum draft for ${access.className} (${placed.length} units${input.template ? ", from the SAT template" : ""})` });
    return cur;
  });
}

async function editableUnit(userId: string, unitId: string) {
  const u = await db.curriculumUnit.findUnique({ where: { id: unitId }, include: { curriculum: true } });
  if (!u) throw new NotFoundError("Unit not found");
  const access = await classAccess(userId, u.curriculum.classId).catch(() => {
    throw new NotFoundError("Unit not found");
  });
  // Teachers edit any unit; specialists only units entirely in their subjects.
  const ok = can(access, "manageClass") || (access.role === "SPECIALIST" && u.domains.length > 0 && (!access.subjects || u.domains.every((d) => access.subjects!.has(d))));
  if (!ok) throw new ClassError("You can't change this unit.", 403);
  return { u, access };
}

export async function updateUnit(userId: string, unitId: string, patch: { title?: string; startsOn?: string; endsOn?: string; notes?: string; domains?: string[] }) {
  const { u, access } = await editableUnit(userId, unitId);
  const data: { title?: string; startsOn?: Date; endsOn?: Date; notes?: string; domains?: string[] } = {};
  if (patch.title !== undefined) data.title = patch.title.trim().slice(0, 120) || u.title;
  if (patch.notes !== undefined) data.notes = patch.notes.trim().slice(0, 1000);
  if (patch.domains !== undefined) {
    data.domains = [...new Set(patch.domains.filter(isDomain))];
    if (access.role === "SPECIALIST" && access.subjects && data.domains.some((d) => !access.subjects!.has(d))) throw new ClassError("Only domains you cover.", 403);
  }
  for (const k of ["startsOn", "endsOn"] as const) {
    if (patch[k] !== undefined) {
      const d = new Date(`${patch[k]}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) throw new ClassError("That date isn't valid.");
      data[k] = d;
    }
  }
  if ((data.startsOn ?? u.startsOn) > (data.endsOn ?? u.endsOn)) throw new ClassError("A unit has to end after it starts.");
  await db.curriculumUnit.update({ where: { id: u.id }, data });
}

export async function publishCurriculum(userId: string, curriculumId: string) {
  const cur = await db.curriculum.findUnique({ where: { id: curriculumId } });
  if (!cur) throw new NotFoundError("Curriculum not found");
  const access = await classAccess(userId, cur.classId, "manageClass");
  await db.$transaction(async (tx) => {
    await tx.curriculum.updateMany({ where: { classId: cur.classId, status: "ACTIVE", id: { not: cur.id } }, data: { status: "ARCHIVED" } });
    await tx.curriculum.update({ where: { id: cur.id }, data: { status: "ACTIVE" } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "curriculum.publish", targetType: "class", targetId: cur.classId, summary: `Published the curriculum for ${access.className}` });
  });
}

/** What a student sees: the published plan only, and this week's unit. */
export async function publishedPlan(userId: string, classId: string, now = new Date()) {
  const member = await db.classMember.count({ where: { classId, userId } });
  if (!member) throw new NotFoundError("Class not found");
  const cur = await db.curriculum.findFirst({ where: { classId, status: "ACTIVE" }, include: { units: { orderBy: { order: "asc" } } } });
  if (!cur) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { title: cur.title, units: cur.units.map((u) => ({ id: u.id, title: u.title, domains: u.domains, startsOn: u.startsOn, endsOn: u.endsOn, notes: u.notes })), current: cur.units.find((u) => u.startsOn <= today && u.endsOn >= today) ?? null };
}

// ─── Pacing suggestions ──────────────────────────────────────────────────

export type Suggestion = { key: string; kind: "REVIEW_WEEK" | "PRACTICE_TEST"; unitId: string; unitTitle: string; reason: string; text: string };

/**
 * Rules (testable, no AI in the decision):
 *  - the current unit's domains are under 60% for the class over the last 2 weeks (10+ answers): add a review week
 *  - half or more of the students with 2+ scores are stalling: add a practice test and review week
 * Claude (Haiku) only rewrites the reason as a friendly suggestion; the rule's own text is used without it.
 */
export async function pacingSuggestions(userId: string, classId: string, deps: { ai?: AssistantModel; wording?: boolean } = {}, now = new Date()) {
  const access = await classAccess(userId, classId);
  const cur = await db.curriculum.findFirst({ where: { classId, status: "ACTIVE" }, include: { units: { orderBy: { order: "asc" } } } });
  if (!cur) return { access, suggestions: [] as Suggestion[] };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const current = cur.units.find((u) => u.startsOn <= today && u.endsOn >= today) ?? cur.units.find((u) => u.startsOn > today);
  if (!current) return { access, suggestions: [] };
  const out: Suggestion[] = [];
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const members = (await db.classMember.findMany({ where: { classId }, select: { userId: true } })).map((m) => m.userId);
  if (current.domains.length) {
    const answers = await db.assignmentAnswer.findMany({ where: { userId: { in: members }, createdAt: { gte: since }, item: { domain: { in: current.domains } } }, select: { score: true } });
    if (answers.length >= 10) {
      const acc = answers.reduce((n, a) => n + a.score, 0) / answers.length;
      if (acc < 0.6) out.push({ key: `REVIEW_WEEK:${current.id}`, kind: "REVIEW_WEEK", unitId: current.id, unitTitle: current.title, reason: `The class is at ${Math.round(acc * 100)}% on ${current.domains.map(domainName).join(" and ")} over the last 2 weeks (${answers.length} answers).`, text: "" });
    }
  }
  const scores = await db.scoreRecord.findMany({ where: { studentId: { in: members } }, select: { studentId: true, total: true, takenOn: true, source: true } });
  const withTwo = members.filter((m) => scores.filter((s) => s.studentId === m).length >= 2);
  const stalled = withTwo.filter((m) => stalling(scores.filter((s) => s.studentId === m)).stalled);
  if (withTwo.length >= 3 && stalled.length * 2 >= withTwo.length) {
    out.push({ key: `PRACTICE_TEST:${current.id}`, kind: "PRACTICE_TEST", unitId: current.id, unitTitle: current.title, reason: `${stalled.length} of ${withTwo.length} students with two or more scores aren't gaining.`, text: "" });
  }
  // Dismissed this week?
  const week = `${today.getUTCFullYear()}-${Math.floor((today.getTime() - Date.UTC(today.getUTCFullYear(), 0, 1)) / (7 * 86_400_000))}`;
  const dismissed = new Set((await db.sentNotice.findMany({ where: { key: { in: out.map((s) => `pacing:${classId}:${s.key}:${week}`) } } })).map((n) => n.key));
  const live = out.filter((s) => !dismissed.has(`pacing:${classId}:${s.key}:${week}`));
  for (const s of live) {
    const plain = s.kind === "REVIEW_WEEK" ? `Add a review week after "${s.unitTitle}". ${s.reason}` : `Add a full practice test and review week after "${s.unitTitle}". ${s.reason}`;
    s.text = plain;
    if (deps.wording) {
      try {
        const r = await (deps.ai ?? getAssistant()).structured({ tier: "small", system: "Rewrite this pacing suggestion for a tutor in one or two plain, encouraging sentences. Keep every number. No preamble.", user: plain, schema: z.object({ text: z.string() }), maxTokens: 300, demo: () => ({ text: plain }) });
        await recordUsage({ userId, feature: "ASSISTANT" }, r.calls);
        if (r.value.text.trim()) s.text = r.value.text.trim().slice(0, 500);
      } catch {
        // The rule's own wording is fine.
      }
    }
  }
  return { access, suggestions: live };
}

/** Accept: add the week after the unit (later units move back a week). Dismiss: hide it for this week. */
export async function actOnSuggestion(userId: string, classId: string, key: string, accept: boolean, now = new Date()) {
  const access = await classAccess(userId, classId, "manageClass");
  const [kind, unitId] = key.split(":");
  const unit = await db.curriculumUnit.findFirst({ where: { id: unitId, curriculum: { classId, status: "ACTIVE" } }, include: { curriculum: { include: { units: true } } } });
  if (!unit || !["REVIEW_WEEK", "PRACTICE_TEST"].includes(kind)) throw new NotFoundError("Suggestion not found");
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const week = `${today.getUTCFullYear()}-${Math.floor((today.getTime() - Date.UTC(today.getUTCFullYear(), 0, 1)) / (7 * 86_400_000))}`;
  if (!accept) {
    await db.sentNotice.upsert({ where: { key: `pacing:${classId}:${key}:${week}` }, create: { key: `pacing:${classId}:${key}:${week}` }, update: {} });
    return;
  }
  const cal = await calendarFor(classId);
  const units = unit.curriculum.units;
  const shifted = shiftUnits(units, unit.order + 1, 1, cal.closedDates);
  const newStart = new Date(unit.endsOn.getTime() + 86_400_000);
  const placed = scheduleUnits([{ weeks: 1 }], newStart, cal.closedDates)[0];
  await db.$transaction(async (tx) => {
    for (const u of shifted.filter((x) => x.order > unit.order)) await tx.curriculumUnit.update({ where: { id: u.id }, data: { order: u.order + 1, startsOn: u.startsOn, endsOn: u.endsOn } });
    await tx.curriculumUnit.create({ data: { curriculumId: unit.curriculumId, order: unit.order + 1, title: kind === "REVIEW_WEEK" ? `Review: ${unit.title}` : "Practice test and review", domains: kind === "REVIEW_WEEK" ? unit.domains : [], skills: [], startsOn: placed.startsOn, endsOn: placed.endsOn, notes: kind === "REVIEW_WEEK" ? "Added from a pacing suggestion: reteach and practise the weakest skills." : "Added from a pacing suggestion: a full Bluebook practice test, then review misses." } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "curriculum.pacing", targetType: "class", targetId: classId, summary: `Accepted a pacing suggestion: ${kind === "REVIEW_WEEK" ? "review week" : "practice test week"} after "${unit.title}"` });
  });
}

export async function setCalendar(userId: string, programId: string, input: { termStart?: string | null; termEnd?: string | null; closedDates?: string[] }) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: userId } });
  if (!p) throw new NotFoundError("Program not found");
  const parse = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) throw new ClassError(`"${s}" isn't a date like 2027-01-18.`);
    return new Date(`${s.trim()}T00:00:00Z`);
  };
  await db.program.update({
    where: { id: programId },
    data: {
      ...(input.termStart !== undefined ? { termStart: input.termStart ? parse(input.termStart) : null } : {}),
      ...(input.termEnd !== undefined ? { termEnd: input.termEnd ? parse(input.termEnd) : null } : {}),
      ...(input.closedDates !== undefined ? { closedDates: [...new Set(input.closedDates.filter((d) => d.trim()))].slice(0, 200).map(parse) } : {}),
    },
  });
}
