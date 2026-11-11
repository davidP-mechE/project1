import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, assignmentAccess, classAccess, ClassError, memberWhere, studentInScope } from "./access";
import { audit } from "./programs";
import { addMistakes } from "./mistakes";
import { addScore } from "./scores";
import { cleanTargets, studentsTargeted, isAssignedToStudent, type Targets } from "./targets";
import { DOMAINS, domainsOf, isSection, scopeCovers, type SectionId } from "@/lib/sat/domains";
import { DEFAULT_CONVERSION, defaultThreshold, estimateSection, gridInMatches, routeFor, type Conversion, type Route } from "@/lib/sat/practice";
import { quickCheck } from "@/lib/grading/normalize";

/**
 * Adaptive SAT-style diagnostics. Staff build one from their tagged questions:
 * per section, a mixed module 1, then a harder or easier module 2 chosen by how
 * module 1 went. Timers run on the server: answers after a module's time are
 * refused, a reload doesn't reset the clock, and an expired module moves on by
 * itself. One attempt per student unless a teacher allows a retake. Results
 * are ESTIMATED section scores, never official ones.
 */

const SECTION_ORDER: SectionId[] = ["RW", "MATH"]; // the SAT's order
const GRACE_MS = 3000; // network delay allowance on the server clock

export type BuildInput = { title: string; sections: SectionId[]; m1Count: number; m2Count: number; m1Minutes: number; m2Minutes: number };

// ─── Staff: building ─────────────────────────────────────────────────────

/** Who may build diagnostics in a program, and for which sections. */
async function builderSections(userId: string, programId: string): Promise<Set<SectionId>> {
  const p = await db.program.findUnique({ where: { id: programId }, select: { adminId: true, classes: { select: { id: true } } } });
  if (!p) throw new NotFoundError("Program not found");
  await assertStaffTwoFactor(userId);
  if (p.adminId === userId) return new Set(SECTION_ORDER);
  const out = new Set<SectionId>();
  for (const c of p.classes) {
    const a = await classAccess(userId, c.id).catch(() => null);
    if (!a || a.role === "VIEWER") continue;
    for (const s of SECTION_ORDER) if (scopeCovers(a.subjects, { section: s, domains: [] })) out.add(s);
  }
  if (out.size === 0) throw new NotFoundError("Program not found");
  return out;
}

/** Questions usable in a diagnostic: the program staff's worksheet questions with confirmed tags, multiple choice or a short (grid-in) answer. */
async function bankFor(programId: string, section: SectionId) {
  const p = await db.program.findUniqueOrThrow({ where: { id: programId }, select: { adminId: true, classes: { select: { staff: { select: { userId: true } } } } } });
  const owners = [...new Set([p.adminId, ...p.classes.flatMap((c) => c.staff.map((s) => s.userId))])];
  return db.worksheetItem.findMany({
    where: { worksheet: { ownerId: { in: owners }, status: "READY" }, archivedAt: null, tagsConfirmed: true, section, type: { in: ["MULTIPLE_CHOICE", "SHORT_ANSWER"] }, OR: [{ worksheet: { source: "UPLOAD" } }, { approvedAt: { not: null } }] },
    orderBy: [{ worksheetId: "asc" }, { order: "asc" }],
    select: { id: true, domain: true, difficulty: true },
  });
}

/** Pick `n` questions spread across domains (round-robin), preferring the given difficulties in order. */
function pick(pool: { id: string; domain: string | null; difficulty: string | null }[], n: number, prefer: string[], exclude: Set<string>) {
  const rank = (d: string | null) => {
    const i = prefer.indexOf(d ?? "");
    return i === -1 ? prefer.length : i;
  };
  const byDomain = new Map<string, typeof pool>();
  for (const q of pool.filter((q) => !exclude.has(q.id)).sort((a, b) => rank(a.difficulty) - rank(b.difficulty))) byDomain.set(q.domain ?? "", [...(byDomain.get(q.domain ?? "") ?? []), q]);
  const out: string[] = [];
  while (out.length < n && [...byDomain.values()].some((l) => l.length)) {
    for (const list of byDomain.values()) {
      const q = list.shift();
      if (q && out.length < n) out.push(q.id);
    }
  }
  return out;
}

export async function createDiagnostic(userId: string, programId: string, input: BuildInput) {
  const allowed = await builderSections(userId, programId);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new ClassError("Give the diagnostic a title.");
  const sections = SECTION_ORDER.filter((s) => input.sections.includes(s));
  if (sections.length === 0) throw new ClassError("Choose at least one section.");
  if (sections.some((s) => !allowed.has(s))) throw new ClassError("You can only build diagnostics for the subjects you cover.", 403);
  for (const [v, lo, hi, what] of [
    [input.m1Count, 2, 40, "Module 1 questions"],
    [input.m2Count, 2, 40, "Module 2 questions"],
    [input.m1Minutes, 1, 120, "Module 1 minutes"],
    [input.m2Minutes, 1, 120, "Module 2 minutes"],
  ] as const) {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new ClassError(`${what} must be ${lo} to ${hi}.`);
  }
  const modules: Prisma.DiagnosticModuleCreateWithoutDiagnosticInput[] = [];
  for (const section of sections) {
    const pool = await bankFor(programId, section);
    const m1 = pick(pool, input.m1Count, ["MEDIUM", "EASY", "HARD", ""], new Set());
    const used = new Set(m1);
    const hard = pick(pool, input.m2Count, ["HARD", "MEDIUM", "", "EASY"], used);
    const easy = pick(pool, input.m2Count, ["EASY", "MEDIUM", "", "HARD"], used);
    const name = section === "MATH" ? "Math" : "Reading and Writing";
    if (m1.length < input.m1Count || hard.length < input.m2Count || easy.length < input.m2Count) {
      throw new ClassError(`Not enough ${name} questions with confirmed tags: ${pool.length} found, and the modules need ${input.m1Count + input.m2Count} (module 1 plus one module 2). Upload and tag more worksheets, or use fewer questions.`);
    }
    modules.push(
      { section, stage: "M1", timeLimitSec: input.m1Minutes * 60, itemIds: m1, routeThreshold: defaultThreshold(m1.length) },
      { section, stage: "M2_HARD", timeLimitSec: input.m2Minutes * 60, itemIds: hard },
      { section, stage: "M2_EASY", timeLimitSec: input.m2Minutes * 60, itemIds: easy },
    );
  }
  return db.diagnostic.create({ data: { programId, createdById: userId, title, modules: { create: modules } } });
}

async function editableDiagnostic(userId: string, diagnosticId: string) {
  const d = await db.diagnostic.findUnique({ where: { id: diagnosticId }, include: { modules: true, program: { select: { adminId: true } }, _count: { select: { assignments: true } } } });
  if (!d) throw new NotFoundError("Diagnostic not found");
  const allowed = await builderSections(userId, d.programId).catch(() => new Set<SectionId>());
  const sections = new Set(d.modules.map((m) => m.section as SectionId));
  if (![...sections].every((s) => allowed.has(s))) throw new NotFoundError("Diagnostic not found");
  return d;
}

/** The builder's view: modules with their questions (and answer keys, for staff). */
export async function getDiagnostic(userId: string, diagnosticId: string) {
  const d = await editableDiagnostic(userId, diagnosticId);
  const items = await db.worksheetItem.findMany({ where: { id: { in: d.modules.flatMap((m) => m.itemIds) } }, select: { id: true, label: true, prompt: true, domain: true, skill: true, difficulty: true, type: true, worksheet: { select: { title: true } } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = (s: string) => ["M1", "M2_HARD", "M2_EASY"].indexOf(s);
  const modules = [...d.modules]
    .sort((a, b) => SECTION_ORDER.indexOf(a.section as SectionId) - SECTION_ORDER.indexOf(b.section as SectionId) || order(a.stage) - order(b.stage))
    .map((m) => ({ ...m, items: m.itemIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])) }));
  // Domain coverage: every domain of the section should appear in module 1.
  const gaps = modules.filter((m) => m.stage === "M1").flatMap((m) => domainsOf(m.section as SectionId).filter((dom) => !m.items.some((i) => i.domain === dom)));
  return { diagnostic: d, modules, coverageGaps: gaps, assigned: d._count.assignments };
}

export async function publishDiagnostic(userId: string, diagnosticId: string) {
  const { diagnostic, modules } = await getDiagnostic(userId, diagnosticId);
  if (modules.some((m) => m.items.length === 0)) throw new ClassError("Every module needs questions.");
  await db.diagnostic.update({ where: { id: diagnostic.id }, data: { status: "PUBLISHED" } });
}

export async function deleteDiagnostic(userId: string, diagnosticId: string) {
  const d = await editableDiagnostic(userId, diagnosticId);
  if (d._count.assignments > 0) throw new ClassError("This diagnostic has been assigned, so it's kept for its results.");
  await db.diagnostic.delete({ where: { id: d.id } });
}

/** Diagnostics in the programs this person builds for. */
export async function listDiagnostics(userId: string) {
  const programs = await db.program.findMany({ where: { OR: [{ adminId: userId }, { classes: { some: { staff: { some: { userId, role: { not: "VIEWER" } } } } } }] }, select: { id: true, name: true } });
  const rows = await db.diagnostic.findMany({ where: { programId: { in: programs.map((p) => p.id) } }, orderBy: { createdAt: "desc" }, include: { modules: { select: { section: true, stage: true, itemIds: true, timeLimitSec: true } }, _count: { select: { assignments: true } } } });
  return { programs, diagnostics: rows };
}

/** Assign a published diagnostic to a class, with an optional window. Its subject is its sections. */
export async function assignDiagnostic(userId: string, classId: string, input: { diagnosticId: string; title?: string; opensAt?: string | null; closesAt?: string | null; targets?: Partial<Targets> }) {
  const access = await classAccess(userId, classId, "teach");
  const targets = await cleanTargets(access, input.targets);
  const d = await db.diagnostic.findFirst({ where: { id: input.diagnosticId, programId: access.programId, status: "PUBLISHED" }, include: { modules: { select: { section: true } } } });
  if (!d) throw new ClassError("Choose a published diagnostic from this program.");
  const sections = [...new Set(d.modules.map((m) => m.section))];
  const work = { section: sections.length === 1 ? sections[0] : null, domains: sections.flatMap((s) => (isSection(s) ? domainsOf(s) : [])) };
  if (!scopeCovers(access.subjects, work)) throw new ClassError("This diagnostic covers subjects outside yours.", 403);
  const opensAt = input.opensAt ? new Date(input.opensAt) : null;
  const closesAt = input.closesAt ? new Date(input.closesAt) : null;
  if ((opensAt && Number.isNaN(opensAt.getTime())) || (closesAt && Number.isNaN(closesAt.getTime()))) throw new ClassError("Those dates aren't valid.");
  if (opensAt && closesAt && closesAt <= opensAt) throw new ClassError("It has to close after it opens.");
  return db.assignment.create({ data: { classId, kind: "DIAGNOSTIC", title: input.title?.trim().slice(0, 200) || d.title, diagnosticId: d.id, opensAt, closesAt, dueAt: closesAt, ...work, ...targets } });
}

/** Let a student take a diagnostic again (one more attempt). */
export async function grantRetake(userId: string, assignmentId: string, studentId: string) {
  const access = await assignmentAccess(userId, assignmentId, "grade");
  if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  await db.$transaction(async (tx) => {
    await tx.diagnosticRetake.create({ data: { assignmentId, userId: studentId, grantedById: userId } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "diagnostic.retake", targetType: "assignment", targetId: assignmentId, summary: "Allowed a student to retake a diagnostic" });
  });
}

// ─── Students: taking it ─────────────────────────────────────────────────

type ModuleRow = { id: string; section: string; stage: string; timeLimitSec: number; itemIds: string[]; routeThreshold: number };

async function studentDiagnostic(userId: string, assignmentId: string) {
  const a = await db.assignment.findFirst({
    where: { id: assignmentId, kind: "DIAGNOSTIC", class: { members: { some: { userId } }, archivedAt: null } },
    include: { diagnostic: { include: { modules: true } }, class: { select: { name: true } } },
  });
  if (!a || !a.diagnostic || !(await isAssignedToStudent(a, userId))) throw new NotFoundError("Diagnostic not found");
  return a as typeof a & { diagnostic: NonNullable<typeof a.diagnostic> };
}

const firstModule = (modules: ModuleRow[], section: SectionId) => modules.find((m) => m.section === section && m.stage === "M1");
const deadline = (m: ModuleRow, startedAt: Date) => new Date(startedAt.getTime() + m.timeLimitSec * 1000);

async function attemptsAllowed(assignmentId: string, userId: string) {
  return 1 + (await db.diagnosticRetake.count({ where: { assignmentId, userId } }));
}

/** Move past expired modules (the clock ran out while the student was away). */
async function catchUp(a: Awaited<ReturnType<typeof studentDiagnostic>>, attemptId: string, now: Date) {
  for (let i = 0; i < 8; i++) {
    const at = await db.diagnosticAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (at.finishedAt || !at.currentModuleId || !at.moduleStartedAt) return at;
    const m = a.diagnostic.modules.find((x) => x.id === at.currentModuleId)!;
    if (now.getTime() <= deadline(m, at.moduleStartedAt).getTime() + GRACE_MS) return at;
    await advance(a, at.id, deadline(m, at.moduleStartedAt));
  }
  return db.diagnosticAttempt.findUniqueOrThrow({ where: { id: attemptId } });
}

/** Hand in the current module: route to module 2, the next section, or finish. */
async function advance(a: Awaited<ReturnType<typeof studentDiagnostic>>, attemptId: string, at: Date) {
  const attempt = await db.diagnosticAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: true } });
  if (attempt.finishedAt || !attempt.currentModuleId) return;
  const modules = a.diagnostic.modules;
  const current = modules.find((m) => m.id === attempt.currentModuleId)!;
  let next: ModuleRow | undefined;
  if (current.stage === "M1") {
    const correct = attempt.answers.filter((x) => x.moduleId === current.id && x.correct).length;
    const route = routeFor(correct, current.routeThreshold);
    next = modules.find((m) => m.section === current.section && m.stage === route);
  } else {
    const sections = SECTION_ORDER.filter((s) => modules.some((m) => m.section === s));
    const after = sections[sections.indexOf(current.section as SectionId) + 1];
    next = after ? firstModule(modules, after) : undefined;
  }
  // Only the request that moves the module on wins (two tabs can't both advance it).
  const moved = await db.diagnosticAttempt.updateMany({
    where: { id: attempt.id, currentModuleId: current.id },
    data: next ? { currentModuleId: next.id, moduleStartedAt: at, path: [...attempt.path, next.id] } : { currentModuleId: null, moduleStartedAt: null, finishedAt: at },
  });
  if (moved.count && !next) await finish(a, attempt.id, at);
}

/** Score it, save the estimate as a DIAGNOSTIC score (both sections), and add misses to the mistake log. */
async function finish(a: Awaited<ReturnType<typeof studentDiagnostic>>, attemptId: string, at: Date) {
  const attempt = await db.diagnosticAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: true } });
  const conversion = { ...DEFAULT_CONVERSION, ...((a.diagnostic.conversion ?? {}) as Partial<Conversion>) };
  const sections = [];
  for (const section of SECTION_ORDER) {
    const taken = attempt.path.map((id) => a.diagnostic.modules.find((m) => m.id === id)!).filter((m) => m.section === section);
    if (!taken.length) continue;
    const route = (taken.find((m) => m.stage !== "M1")?.stage ?? "M2_EASY") as Route;
    const total = taken.reduce((n, m) => n + m.itemIds.length, 0);
    const correct = attempt.answers.filter((x) => taken.some((m) => m.id === x.moduleId) && x.correct).length;
    sections.push({ section, route, correct, total, estimate: estimateSection(correct, total, route, conversion) });
  }
  const totalEstimate = sections.length === 2 ? sections.reduce((n, s) => n + s.estimate, 0) : null;
  await db.diagnosticAttempt.update({ where: { id: attempt.id }, data: { results: { sections, total: totalEstimate } as Prisma.InputJsonValue } });
  if (totalEstimate !== null) {
    await addScore(attempt.userId, attempt.userId, {
      source: "DIAGNOSTIC",
      takenOn: at.toISOString(),
      testName: a.diagnostic.title.slice(0, 120),
      total: totalEstimate,
      rw: sections.find((s) => s.section === "RW")!.estimate,
      math: sections.find((s) => s.section === "MATH")!.estimate,
    }).catch((err) => console.warn("[diagnostics] score not saved:", err instanceof Error ? err.message : err));
  }
  const wrong = attempt.answers.filter((x) => !x.correct);
  const items = await db.worksheetItem.findMany({ where: { id: { in: wrong.map((w) => w.itemId) } }, select: { id: true, label: true, section: true, domain: true, skill: true } });
  await addMistakes(
    attempt.userId,
    items.map((i) => ({ sourceType: "DIAGNOSTIC", sourceId: `${attempt.id}:${i.id}`, itemId: i.id, section: i.section, domain: i.domain, skill: i.skill, label: `${a.diagnostic.title}: question ${i.label}` })),
    at,
  );
}

const pubQuestion = (i: { id: string; label: string; type: string; prompt: string; choices: string[]; domain: string | null; desmosSolvable: boolean; section: string | null }) => ({
  id: i.id,
  label: i.label,
  type: i.type,
  prompt: i.prompt,
  choices: i.choices,
  section: i.section,
  desmos: i.section === "MATH",
});

/** Everything the student's page needs: before, during (current module, time left, no answer keys) and after. */
export async function diagnosticState(userId: string, assignmentId: string, now = new Date()) {
  const a = await studentDiagnostic(userId, assignmentId);
  const attempts = await db.diagnosticAttempt.findMany({ where: { assignmentId, userId }, orderBy: { attemptNo: "asc" } });
  const allowed = await attemptsAllowed(assignmentId, userId);
  let current = attempts.find((x) => !x.finishedAt) ?? null;
  if (current) current = await catchUp(a, current.id, now);
  const open = (!a.opensAt || a.opensAt <= now) && (!a.closesAt || a.closesAt > now);
  const finished = (await db.diagnosticAttempt.findMany({ where: { assignmentId, userId, finishedAt: { not: null } }, orderBy: { attemptNo: "desc" } }))[0] ?? null;
  const base = {
    id: a.id,
    title: a.title,
    className: a.class.name,
    opensAt: a.opensAt,
    closesAt: a.closesAt,
    open,
    sections: [...new Set(a.diagnostic.modules.map((m) => m.section))],
    moduleCount: new Set(a.diagnostic.modules.map((m) => m.section)).size * 2,
    canStart: open && !(current && !current.finishedAt) && attempts.length < allowed,
    attemptsUsed: attempts.length,
    attemptsAllowed: allowed,
  };
  if (current && !current.finishedAt && current.currentModuleId) {
    const m = a.diagnostic.modules.find((x) => x.id === current.currentModuleId)!;
    const items = await db.worksheetItem.findMany({ where: { id: { in: m.itemIds } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const answers = await db.diagnosticAnswer.findMany({ where: { attemptId: current.id, moduleId: m.id } });
    return {
      ...base,
      phase: "taking" as const,
      module: { id: m.id, section: m.section, number: current.path.length, endsAt: deadline(m, current.moduleStartedAt!) },
      questions: m.itemIds.flatMap((id) => (byId.get(id) ? [pubQuestion(byId.get(id)!)] : [])),
      saved: Object.fromEntries(answers.map((x) => [x.itemId, { choice: x.choice, response: x.response }])),
    };
  }
  if (finished) {
    const reveal = !a.closesAt || a.closesAt <= now;
    const answers = await db.diagnosticAnswer.findMany({ where: { attemptId: finished.id } });
    const items = await db.worksheetItem.findMany({ where: { id: { in: finished.path.flatMap((mid) => a.diagnostic.modules.find((m) => m.id === mid)?.itemIds ?? []) } } });
    const byDomain = new Map<string, { n: number; right: number }>();
    for (const i of items) {
      const got = answers.find((x) => x.itemId === i.id);
      const d = byDomain.get(i.domain ?? "") ?? { n: 0, right: 0 };
      d.n += 1;
      d.right += got?.correct ? 1 : 0;
      byDomain.set(i.domain ?? "", d);
    }
    return {
      ...base,
      phase: "done" as const,
      results: finished.results as { sections: { section: string; route: string; correct: number; total: number; estimate: number }[]; total: number | null } | null,
      domains: [...byDomain.entries()].map(([domain, d]) => ({ domain, accuracy: d.n ? d.right / d.n : 0, n: d.n })),
      review: reveal
        ? items.map((i) => {
            const got = answers.find((x) => x.itemId === i.id);
            return { ...pubQuestion(i), correctChoice: i.correctChoice, answer: i.answer, explanation: i.explanation, yourChoice: got?.choice ?? null, yourResponse: got?.response ?? null, correct: got?.correct ?? false };
          })
        : null,
    };
  }
  return { ...base, phase: "before" as const };
}

export async function startDiagnostic(userId: string, assignmentId: string, now = new Date()) {
  const a = await studentDiagnostic(userId, assignmentId);
  if (a.opensAt && a.opensAt > now) throw new ClassError("This diagnostic isn't open yet.");
  if (a.closesAt && a.closesAt <= now) throw new ClassError("This diagnostic has closed.");
  const attempts = await db.diagnosticAttempt.findMany({ where: { assignmentId, userId } });
  if (attempts.some((x) => !x.finishedAt)) return;
  if (attempts.length >= (await attemptsAllowed(assignmentId, userId))) throw new ClassError("You've already taken this diagnostic. Ask your teacher if you need a retake.", 409);
  const firstSection = SECTION_ORDER.find((s) => a.diagnostic.modules.some((m) => m.section === s))!;
  const m1 = firstModule(a.diagnostic.modules, firstSection)!;
  try {
    await db.diagnosticAttempt.create({ data: { assignmentId, userId, attemptNo: attempts.length + 1, currentModuleId: m1.id, moduleStartedAt: now, startedAt: now, path: [m1.id] } });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err; // started twice at once: the other one won
  }
}

/** Save an answer in the current module. Results stay hidden until the end. */
export async function answerDiagnostic(userId: string, assignmentId: string, itemId: string, input: { choice?: unknown; response?: unknown; timeMs?: unknown; usedDesmos?: unknown }, now = new Date()) {
  const a = await studentDiagnostic(userId, assignmentId);
  const open = await db.diagnosticAttempt.findFirst({ where: { assignmentId, userId, finishedAt: null } });
  if (!open) throw new ClassError("Start the diagnostic first.", 409);
  const at = await catchUp(a, open.id, now);
  if (at.finishedAt || at.currentModuleId !== open.currentModuleId) throw new ClassError("Time's up for that module: your answers were handed in.", 409);
  const m = a.diagnostic.modules.find((x) => x.id === at.currentModuleId)!;
  if (!m.itemIds.includes(itemId)) throw new NotFoundError("Question not found");
  const item = await db.worksheetItem.findUniqueOrThrow({ where: { id: itemId } });
  let correct = false;
  let choice: number | null = null;
  let response: string | null = null;
  if (item.type === "MULTIPLE_CHOICE") {
    if (typeof input.choice !== "number" || !Number.isInteger(input.choice) || input.choice < 0 || input.choice >= item.choices.length) throw new ClassError("Choose one of the options.");
    choice = input.choice;
    correct = choice === item.correctChoice;
  } else {
    if (typeof input.response !== "string" || !input.response.trim() || input.response.length > 200) throw new ClassError("Enter an answer.");
    response = input.response.trim();
    correct = gridInMatches(item.answer, response) || quickCheck(item.answer, response) === "correct";
  }
  const timeMs = typeof input.timeMs === "number" && input.timeMs >= 0 ? Math.min(Math.round(input.timeMs), 3_600_000) : 0;
  const usedDesmos = input.usedDesmos === true && item.section === "MATH";
  await db.diagnosticAnswer.upsert({
    where: { attemptId_itemId: { attemptId: at.id, itemId } },
    create: { attemptId: at.id, moduleId: m.id, itemId, itemVersion: item.version, choice, response, correct, timeMs, usedDesmos },
    update: { choice, response, correct, timeMs: { increment: timeMs }, usedDesmos: usedDesmos || undefined },
  });
}

/** The student hands in the current module early. */
export async function submitModule(userId: string, assignmentId: string, moduleId: string, now = new Date()) {
  const a = await studentDiagnostic(userId, assignmentId);
  const open = await db.diagnosticAttempt.findFirst({ where: { assignmentId, userId, finishedAt: null } });
  if (!open) return;
  const at = await catchUp(a, open.id, now);
  if (at.currentModuleId === moduleId) await advance(a, at.id, now);
}

// ─── Staff: results ──────────────────────────────────────────────────────

export async function diagnosticReport(userId: string, assignmentId: string) {
  const access = await assignmentAccess(userId, assignmentId);
  const a = await db.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { diagnostic: { include: { modules: true } }, class: { select: { members: { where: memberWhere(access), orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true } } } } } } } });
  if (!a.diagnostic) throw new NotFoundError("Assignment not found");
  const forThem = await studentsTargeted(a, a.class.members.map((m) => m.user.id));
  const students = a.class.members.map((m) => m.user).filter((u) => forThem.has(u.id));
  const attempts = await db.diagnosticAttempt.findMany({ where: { assignmentId, userId: { in: students.map((s) => s.id) } }, orderBy: { attemptNo: "asc" }, include: { answers: true } });
  const allItems = await db.worksheetItem.findMany({ where: { id: { in: a.diagnostic.modules.flatMap((m) => m.itemIds) } }, select: { id: true, domain: true, desmosSolvable: true } });
  const itemOf = new Map(allItems.map((i) => [i.id, i]));
  const rows = students.map((s) => {
    const mine = attempts.filter((x) => x.userId === s.id);
    const last = mine.at(-1) ?? null;
    return { student: s, attempts: mine.length, status: !last ? "not_started" : last.finishedAt ? "done" : "in_progress", results: (last?.results ?? null) as { sections: { section: string; route: string; correct: number; total: number; estimate: number }[]; total: number | null } | null };
  });
  const done = attempts.filter((x) => x.finishedAt);
  const lastDone = new Map(done.map((x) => [x.userId, x]));
  const answers = [...lastDone.values()].flatMap((x) => x.answers);
  const domains = DOMAINS.filter((d) => a.diagnostic!.modules.some((m) => m.section === d.section)).map((d) => {
    const got = answers.filter((x) => itemOf.get(x.itemId)?.domain === d.id);
    return { domain: d.id, name: d.name, answered: got.length, accuracy: got.length ? got.filter((x) => x.correct).length / got.length : null, avgSeconds: got.length ? Math.round(got.reduce((n, x) => n + x.timeMs, 0) / got.length / 1000) : null };
  });
  const desmos = answers.filter((x) => itemOf.get(x.itemId)?.desmosSolvable);
  const split = (used: boolean) => {
    const g = desmos.filter((x) => x.usedDesmos === used);
    return { answered: g.length, accuracy: g.length ? g.filter((x) => x.correct).length / g.length : null };
  };
  return { access, assignment: { id: a.id, title: a.title, classId: a.classId, opensAt: a.opensAt, closesAt: a.closesAt }, students: rows, domains, desmos: { with: split(true), without: split(false) } };
}
