import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { can, classAccess, ClassError, staffClassIds, studentInScope, type ClassAccess } from "./access";
import { classProgress } from "./classes";
import { domainTally } from "./pacing";
import { projectScore } from "@/lib/sat/scores";
import { domainName } from "@/lib/sat/domains";

/**
 * "Needs attention": one ranked to-do list for each staff member, across every
 * class and student in their scope. Worked out fresh from the data each time,
 * reusing what the rest of the site already computes:
 *   WORK      missed or late work: the class progress grid (classProgress, the
 *             same grid behind class alerts and the gradebook)
 *   ACCURACY  accuracy over the last 2 weeks against the 4 weeks before
 *             (domainTally, the plan's per-domain tally, plus question-bank practice)
 *   INACTIVE  no login and no practice for N days (N is set per program)
 *   SKILL     the same skill missed 3+ times in 30 days (the error log and the mistake log)
 *   PACE      the score estimate (projectScore, the Scores page's estimate) below
 *             the straight line from baseline to target by the test date
 *
 * Scope: only students the viewer may see, and for subject-limited specialists
 * only their subjects (accuracy, skills). Viewers see the list without actions.
 *
 * "Handled" and "Snoozed" are shared by the program's staff (AttentionState),
 * and hide an item only while its fingerprint (what triggered it) is unchanged.
 * No AI.
 */

export const REASONS = ["PACE", "ACCURACY", "WORK", "SKILL", "INACTIVE"] as const;
export type AttentionReason = (typeof REASONS)[number];

export const REASON_LABEL: Record<AttentionReason, string> = {
  WORK: "Missed or late work",
  ACCURACY: "Accuracy dropping",
  INACTIVE: "Inactive",
  SKILL: "Same skill missed",
  PACE: "Below target pace",
};

export type AttentionItem = {
  key: string;
  studentId: string;
  name: string;
  classId: string;
  className: string;
  programId: string;
  reason: AttentionReason;
  detail: string;
  numbers: { label: string; value: string }[];
  priority: number;
  fingerprint: string;
  /** For "assign practice": the skill to practise, when there is one. */
  skill: { id: string; name: string } | null;
  canAct: boolean;
  tutorId: string | null;
};

const DAY = 86_400_000;
const RECENT_DAYS = 14;
const BEFORE_DAYS = 28;
const MIN_ANSWERS = 8;
const DROP = 0.15;
const SKILL_DAYS = 30;
const SKILL_MISSES = 3;
const PACE_SLACK = 30;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
/** The domain id of a skill id like "rw.conventions.boundaries". */
const domainOfSkill = (skillId: string | null | undefined) => skillId?.split(".")[1] ?? null;
const inSubjects = (a: ClassAccess, domain: string | null | undefined) => !a.subjects || (domain ? a.subjects.has(domain) : false);

/** Prefer the access with the widest view of a student (a teacher's over a specialist's). */
const width = (a: ClassAccess) => (a.subjects ? 0 : 2) + (a.groupIds.length ? 0 : 1);

type Student = { id: string; name: string; access: ClassAccess; className: string };

/** Every student in scope across the viewer's classes, each with the widest access the viewer has to them. */
async function studentsInScope(userId: string, opts: { classId?: string } = {}, now = new Date()) {
  const ids = opts.classId ? [opts.classId] : await staffClassIds(userId);
  const live = await db.class.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
  if (opts.classId && !live.length) throw new NotFoundError("Class not found");
  const students = new Map<string, Student>();
  const work: { access: ClassAccess; grid: Awaited<ReturnType<typeof classProgress>> }[] = [];
  for (const { id } of live) {
    let access: ClassAccess;
    try {
      access = await classAccess(userId, id);
    } catch (err) {
      // A class the viewer asked for by id is "not found"; in the full list it's just skipped.
      if (err instanceof NotFoundError && !opts.classId) continue;
      throw err;
    }
    const grid = await classProgress(userId, id, now);
    work.push({ access, grid });
    for (const s of grid.students) {
      const prev = students.get(s.id);
      if (!prev || width(access) > width(prev.access)) students.set(s.id, { id: s.id, name: s.name, access, className: access.className });
    }
  }
  return { students, work };
}

/** Missed (overdue, not done) and late (handed in after the due date, last 2 weeks) work, per class. */
function workItems(work: Awaited<ReturnType<typeof studentsInScope>>["work"], now: Date) {
  const out: Omit<AttentionItem, "canAct" | "tutorId">[] = [];
  const recent = now.getTime() - RECENT_DAYS * DAY;
  for (const { access, grid } of work) {
    for (const s of grid.students) {
      const missed = grid.assignments.filter((a) => {
        const c = grid.cells[`${s.id}:${a.id}`];
        return a.dueAt && a.dueAt < now && c && c.status !== "done" && c.status !== "not_assigned";
      });
      const late = grid.assignments.filter((a) => {
        const c = grid.cells[`${s.id}:${a.id}`];
        return c?.status === "done" && c.late && c.lastActive && c.lastActive.getTime() >= recent;
      });
      if (!missed.length && !late.length) continue;
      const names = missed.map((a) => a.title);
      out.push({
        key: `${access.classId}:${s.id}:WORK`,
        studentId: s.id,
        name: s.name,
        classId: access.classId,
        className: access.className,
        programId: access.programId,
        reason: "WORK",
        detail: missed.length ? `${missed.length} overdue: ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}` : `${late.length} handed in late in the last 2 weeks`,
        numbers: [
          { label: "Overdue", value: String(missed.length) },
          { label: "Late (2 weeks)", value: String(late.length) },
        ],
        priority: 30 + 6 * missed.length + 2 * late.length,
        fingerprint: `${missed.map((a) => a.id).sort().join(",")}|${late.map((a) => a.id).sort().join(",")}`,
        skill: null,
      });
    }
  }
  return out;
}

/** Accuracy in the scope's subjects from a tally (domain → answers, points). */
function accuracyIn(tally: Map<string, { n: number; sum: number }>, access: ClassAccess) {
  let n = 0;
  let sum = 0;
  for (const [d, t] of tally) {
    if (!inSubjects(access, d)) continue;
    n += t.n;
    sum += t.sum;
  }
  return { n, sum };
}

async function bankTally(studentId: string, fromDays: number, toDays: number, now: Date) {
  const rows = await db.bankAttempt.findMany({
    where: { userId: studentId, createdAt: { gte: new Date(now.getTime() - fromDays * DAY), lt: new Date(now.getTime() - toDays * DAY) } },
    select: { correct: true, question: { select: { skillId: true } } },
  });
  const tally = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const d = domainOfSkill(r.question.skillId);
    if (!d) continue;
    const t = tally.get(d) ?? { n: 0, sum: 0 };
    t.n += 1;
    t.sum += r.correct ? 1 : 0;
    tally.set(d, t);
  }
  return tally;
}

function merge(...tallies: Map<string, { n: number; sum: number }>[]) {
  const out = new Map<string, { n: number; sum: number }>();
  for (const t of tallies) for (const [d, v] of t) out.set(d, { n: (out.get(d)?.n ?? 0) + v.n, sum: (out.get(d)?.sum ?? 0) + v.sum });
  return out;
}

function minus(a: Map<string, { n: number; sum: number }>, b: Map<string, { n: number; sum: number }>) {
  const out = new Map<string, { n: number; sum: number }>();
  for (const [d, v] of a) out.set(d, { n: v.n - (b.get(d)?.n ?? 0), sum: v.sum - (b.get(d)?.sum ?? 0) });
  return out;
}

async function studentItems(s: Student, inactiveDays: number, now: Date) {
  const out: Omit<AttentionItem, "canAct" | "tutorId">[] = [];
  const base = { studentId: s.id, name: s.name, classId: s.access.classId, className: s.className, programId: s.access.programId };
  const item = (reason: AttentionReason, rest: Pick<AttentionItem, "detail" | "numbers" | "priority" | "fingerprint" | "skill">) => out.push({ ...base, key: `${s.access.classId}:${s.id}:${reason}`, reason, ...rest });

  // Accuracy: the last 2 weeks against the 4 weeks before (assignments, diagnostics, College Board links and bank practice).
  const [last14, last42, bankRecent, bankBefore] = await Promise.all([
    domainTally(s.id, RECENT_DAYS, now),
    domainTally(s.id, RECENT_DAYS + BEFORE_DAYS, now),
    bankTally(s.id, RECENT_DAYS, 0, now),
    bankTally(s.id, RECENT_DAYS + BEFORE_DAYS, RECENT_DAYS, now),
  ]);
  const recent = accuracyIn(merge(last14, bankRecent), s.access);
  const before = accuracyIn(merge(minus(last42, last14), bankBefore), s.access);
  if (recent.n >= MIN_ANSWERS && before.n >= MIN_ANSWERS) {
    const r = recent.sum / recent.n;
    const b = before.sum / before.n;
    if (b - r >= DROP) {
      item("ACCURACY", {
        detail: `${pct(r)} in the last 2 weeks, down from ${pct(b)}`,
        numbers: [
          { label: "Last 2 weeks", value: `${pct(r)} of ${recent.n}` },
          { label: "4 weeks before", value: `${pct(b)} of ${before.n}` },
        ],
        priority: 40 + Math.round((b - r) * 100),
        fingerprint: `band:${Math.floor(r * 10)}`,
        skill: null,
      });
    }
  }

  // Inactive: no login and no practice of any kind for N days.
  const [u, lastAnswer, lastBank, lastDay] = await Promise.all([
    db.user.findUnique({ where: { id: s.id }, select: { lastLoginAt: true, createdAt: true } }),
    db.assignmentAnswer.findFirst({ where: { userId: s.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.bankAttempt.findFirst({ where: { userId: s.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.studyDay.findFirst({ where: { userId: s.id, lastActiveAt: { not: null } }, orderBy: { lastActiveAt: "desc" }, select: { lastActiveAt: true } }),
  ]);
  const seen = [u?.lastLoginAt, lastAnswer?.createdAt, lastBank?.createdAt, lastDay?.lastActiveAt].filter((d): d is Date => Boolean(d));
  const last = seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null;
  const since = last ?? u?.createdAt ?? null;
  const idle = since ? Math.floor((now.getTime() - since.getTime()) / DAY) : 0;
  if (idle >= inactiveDays) {
    item("INACTIVE", {
      detail: last ? `No login or practice for ${days(idle)}` : `Hasn't logged in or practised since joining (${days(idle)})`,
      numbers: [{ label: "Days inactive", value: String(idle) }],
      priority: 25 + Math.min(30, idle),
      fingerprint: `last:${(last ?? since)?.toISOString() ?? "never"}`,
      skill: null,
    });
  }

  // The same skill missed again and again: the error log (practice tests), the mistake log, and bank practice, 30 days.
  const from = new Date(now.getTime() - SKILL_DAYS * DAY);
  const [logged, mistakes, bankMisses] = await Promise.all([
    db.attemptItem.findMany({ where: { attempt: { userId: s.id, dateTaken: { gte: from } }, result: { in: ["wrong", "guessed"] }, skillId: { not: null } }, select: { skillId: true } }),
    db.mistakeItem.findMany({ where: { studentId: s.id, createdAt: { gte: from }, skill: { not: null } }, select: { skill: true, domain: true } }),
    db.bankAttempt.findMany({ where: { userId: s.id, createdAt: { gte: from }, correct: false }, select: { question: { select: { skillId: true } } } }),
  ]);
  const skills = await db.skill.findMany({ where: { parentId: { not: null } }, select: { id: true, name: true } });
  const byName = new Map(skills.map((k) => [k.name.toLowerCase(), k.id]));
  const nameOf = new Map(skills.map((k) => [k.id, k.name]));
  const misses = new Map<string, number>();
  const add = (id: string | null | undefined) => {
    if (!id || !inSubjects(s.access, domainOfSkill(id))) return;
    misses.set(id, (misses.get(id) ?? 0) + 1);
  };
  for (const r of logged) add(r.skillId);
  for (const r of bankMisses) add(r.question.skillId);
  for (const m of mistakes) add(byName.get(m.skill!.toLowerCase()));
  const worst = [...misses.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (worst && worst[1] >= SKILL_MISSES) {
    const name = nameOf.get(worst[0]) ?? "a skill";
    item("SKILL", {
      detail: `Missed ${name} ${worst[1]} times in 30 days`,
      numbers: [
        { label: "Skill", value: name },
        { label: "Domain", value: domainName(domainOfSkill(worst[0])) },
        { label: "Misses (30 days)", value: String(worst[1]) },
      ],
      priority: 20 + 3 * worst[1],
      fingerprint: `${worst[0]}:${worst[1]}`,
      skill: { id: worst[0], name },
    });
  }

  // Pace: the score estimate against a straight line from the baseline to the target by the test date.
  const [scores, profile, program] = await Promise.all([
    db.scoreRecord.findMany({ where: { studentId: s.id }, orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }], select: { id: true, takenOn: true, total: true, source: true, isBaseline: true } }),
    db.studentProfile.findUnique({ where: { userId: s.id }, select: { targetScore: true, testDate: true } }),
    db.program.findUnique({ where: { id: s.access.programId }, select: { targets: true } }),
  ]);
  const baseline = scores.find((r) => r.isBaseline) ?? scores[0];
  const target = profile?.targetScore ?? program?.targets[0] ?? null;
  if (baseline && target && profile?.testDate && profile.testDate > now && target > baseline.total) {
    const latest = scores.at(-1)!;
    const answers = await db.assignmentAnswer.findMany({ where: { userId: s.id, createdAt: { gt: latest.takenOn } }, select: { score: true } });
    const est = projectScore(
      scores.map((r) => ({ takenOn: r.takenOn, total: r.total, source: r.source })),
      answers.length ? { answered: answers.length, accuracy: answers.reduce((a, x) => a + x.score, 0) / answers.length } : null,
      now,
    );
    const span = profile.testDate.getTime() - baseline.takenOn.getTime();
    const done = span > 0 ? Math.min(1, Math.max(0, (now.getTime() - baseline.takenOn.getTime()) / span)) : 1;
    const onPace = Math.round((baseline.total + (target - baseline.total) * done) / 10) * 10;
    if (est && est.mid < onPace - PACE_SLACK) {
      item("PACE", {
        detail: `Estimate ${est.mid}, on-pace score ${onPace} for ${target} by the test date`,
        numbers: [
          { label: "Estimate", value: `${est.low}–${est.high}` },
          { label: "On pace now", value: String(onPace) },
          { label: "Target", value: String(target) },
        ],
        priority: 50 + Math.min(40, Math.round((onPace - est.mid) / 10)),
        fingerprint: `score:${latest.id}`,
        skill: null,
      });
    }
  }
  return out;
}

/**
 * The viewer's needs-attention list, highest priority first. Filters: one
 * class, one reason, only the viewer's caseload. Hidden (handled or snoozed)
 * items are left out unless `includeHidden`.
 */
export async function attentionList(userId: string, opts: { classId?: string; reason?: AttentionReason; mine?: boolean; studentId?: string; includeHidden?: boolean } = {}, now = new Date()) {
  const { students, work } = await studentsInScope(userId, { classId: opts.classId }, now);
  if (opts.studentId) for (const id of [...students.keys()]) if (id !== opts.studentId) students.delete(id);
  const programIds = [...new Set([...students.values()].map((s) => s.access.programId))];
  const [programs, tutors] = await Promise.all([
    db.program.findMany({ where: { id: { in: programIds } }, select: { id: true, inactiveDays: true } }),
    db.primaryTutor.findMany({ where: { programId: { in: programIds }, studentId: { in: [...students.keys()] } }, select: { programId: true, studentId: true, tutorId: true } }),
  ]);
  const inactive = new Map(programs.map((p) => [p.id, p.inactiveDays]));
  const tutorOf = new Map(tutors.map((t) => [`${t.programId}:${t.studentId}`, t.tutorId]));

  const raw = workItems(work, now).filter((i) => students.has(i.studentId));
  for (const s of students.values()) raw.push(...(await studentItems(s, inactive.get(s.access.programId) ?? 7, now)));

  // One item per student and reason (work can show up in two classes: keep the bigger one).
  const best = new Map<string, (typeof raw)[number]>();
  for (const i of raw) {
    const k = `${i.programId}:${i.studentId}:${i.reason}`;
    if (!best.has(k) || best.get(k)!.priority < i.priority) best.set(k, i);
  }
  const states = await db.attentionState.findMany({ where: { programId: { in: programIds }, studentId: { in: [...students.keys()] } } });
  const stateOf = new Map(states.map((x) => [`${x.programId}:${x.studentId}:${x.reason}`, x]));
  const all: (AttentionItem & { hidden: { action: string; until: Date | null } | null })[] = [];
  for (const [k, i] of best) {
    const st = stateOf.get(k);
    const hidden = st && st.fingerprint === i.fingerprint && (st.until === null || st.until > now) ? { action: st.action, until: st.until } : null;
    const s = students.get(i.studentId)!;
    all.push({ ...i, canAct: can(s.access, "grade"), tutorId: tutorOf.get(`${i.programId}:${i.studentId}`) ?? null, hidden });
  }
  const shown = all
    .filter((i) => (opts.includeHidden || !i.hidden) && (!opts.reason || i.reason === opts.reason) && (!opts.mine || i.tutorId === userId))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  return { items: shown, hiddenCount: all.filter((i) => i.hidden).length, students: students.size };
}

// The sidebar count, kept for a few minutes per person (the list itself is always worked out fresh).
const COUNT_TTL = 5 * 60_000;
const counts = new Map<string, { at: number; n: number }>();

export async function attentionCount(userId: string, now = new Date()) {
  const hit = counts.get(userId);
  if (hit && now.getTime() - hit.at < COUNT_TTL) return hit.n;
  let n = 0;
  try {
    n = (await attentionList(userId, {}, now)).items.length;
  } catch (err) {
    if (!(err instanceof NotFoundError || err instanceof ClassError)) throw err;
  }
  counts.set(userId, { at: now.getTime(), n });
  return n;
}

export function forgetAttentionCounts() {
  counts.clear();
}

/**
 * Mark an item handled (hidden until something new happens) or snooze it for
 * 1–30 days. The item is worked out again here, so the stored fingerprint is
 * the real one. Anyone who can grade the student may do this.
 */
export async function markAttention(userId: string, input: { classId: string; studentId: string; reason: AttentionReason; action: "HANDLED" | "SNOOZED"; days?: number }, now = new Date()) {
  if (!(REASONS as readonly string[]).includes(input.reason)) throw new ClassError("Unknown reason.");
  const access = await classAccess(userId, input.classId, "grade");
  if (!(await studentInScope(access, input.studentId))) throw new NotFoundError("Student not found");
  const { items } = await attentionList(userId, { studentId: input.studentId, includeHidden: true }, now);
  const it = items.find((i) => i.reason === input.reason && i.programId === access.programId);
  if (!it) throw new ClassError("That item has already cleared.");
  const until = input.action === "SNOOZED" ? new Date(now.getTime() + Math.min(30, Math.max(1, Math.round(input.days ?? 7))) * DAY) : null;
  await db.attentionState.upsert({
    where: { programId_studentId_reason: { programId: access.programId, studentId: input.studentId, reason: input.reason } },
    create: { programId: access.programId, studentId: input.studentId, reason: input.reason, fingerprint: it.fingerprint, action: input.action, until, byId: userId, createdAt: now },
    update: { fingerprint: it.fingerprint, action: input.action, until, byId: userId, createdAt: now },
  });
  forgetAttentionCounts();
}

/** Bring a handled or snoozed item back. */
export async function reopenAttention(userId: string, input: { classId: string; studentId: string; reason: AttentionReason }) {
  const access = await classAccess(userId, input.classId, "grade");
  if (!(await studentInScope(access, input.studentId))) throw new NotFoundError("Student not found");
  await db.attentionState.deleteMany({ where: { programId: access.programId, studentId: input.studentId, reason: input.reason } });
  forgetAttentionCounts();
}

/** Published sets a student could practise for a skill (most questions on it first), for "assign practice". */
export async function setsForSkill(skillId: string | null, take = 5) {
  const sets = await db.questionSet.findMany({
    where: { status: "published", visibility: { not: "private" }, autoForStudentId: null, ...(skillId ? { skillIds: { has: skillId } } : {}) },
    select: { id: true, title: true, questionIds: true },
    take: 50,
  });
  if (!skillId) return sets.slice(0, take).map((s) => ({ id: s.id, title: s.title, onSkill: 0 }));
  const qs = await db.bankQuestion.findMany({ where: { id: { in: sets.flatMap((s) => s.questionIds) }, status: "published", skillId }, select: { id: true } });
  const on = new Set(qs.map((q) => q.id));
  return sets
    .map((s) => ({ id: s.id, title: s.title, onSkill: s.questionIds.filter((id) => on.has(id)).length }))
    .filter((s) => s.onSkill > 0)
    .sort((a, b) => b.onSkill - a.onSkill)
    .slice(0, take);
}
