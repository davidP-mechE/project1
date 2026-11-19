/**
 * Weekly auto-assigned practice: picking a student's 8–12 questions by rules
 * (no AI). Pure, so it's unit-tested on its own; src/server/auto-practice.ts
 * gathers the inputs.
 *
 * 1. Weak skills, weakest first: misses (error log, mistake log, wrong
 *    practice answers in the last 60 days) count 2 each, plus the share
 *    wrong on that skill's answers when there are 3 or more.
 * 2. Questions: published bank questions on those skills, never one answered
 *    correctly in the last 30 days or already in a recent auto set. Unseen
 *    questions first, then easier before harder.
 * 3. The top three skills share the set 4 / 3 / 3; a skill short of
 *    questions passes its places to the next weak skill.
 */

export const AUTO_MIN = 8;
export const AUTO_MAX = 12;
export const AUTO_SIZE = 10;

export type SkillStat = { skillId: string; misses: number; answered: number; correct: number };
export type PoolQuestion = { id: string; skillId: string; difficulty: number };

/** Weakness score for one skill; 0 = no sign of trouble. */
export function weakness(s: SkillStat) {
  const wrongShare = s.answered >= 3 ? (s.answered - s.correct) / s.answered : 0;
  return s.misses * 2 + wrongShare * Math.min(s.answered, 10);
}

/** Skills with any sign of trouble, weakest first (ties: by id, so the result is stable). */
export function weakSkills(stats: SkillStat[]) {
  return stats
    .map((s) => ({ ...s, score: weakness(s) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.skillId.localeCompare(b.skillId));
}

/** A stable, spread-out order for questions of equal rank (different per student). */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type AutoPick = { questionIds: string[]; skillIds: string[] } | { questionIds: []; skillIds: []; reason: string };

export function pickAutoSet(input: {
  stats: SkillStat[];
  pool: PoolQuestion[];
  /** Answered correctly in the last 30 days, or already in a recent auto set. */
  exclude: Set<string>;
  /** Ever attempted (unseen questions go first). */
  seen: Set<string>;
  seed: string;
  size?: number;
}): AutoPick {
  const size = Math.min(AUTO_MAX, Math.max(AUTO_MIN, input.size ?? AUTO_SIZE));
  const weak = weakSkills(input.stats);
  if (!weak.length) return { questionIds: [], skillIds: [], reason: "No practice data yet to find weak skills." };
  const bySkill = new Map<string, PoolQuestion[]>();
  for (const q of input.pool) {
    if (input.exclude.has(q.id)) continue;
    bySkill.set(q.skillId, [...(bySkill.get(q.skillId) ?? []), q]);
  }
  for (const qs of bySkill.values()) qs.sort((a, b) => Number(input.seen.has(a.id)) - Number(input.seen.has(b.id)) || a.difficulty - b.difficulty || hash(input.seed + a.id) - hash(input.seed + b.id));
  const usable = weak.filter((w) => bySkill.get(w.skillId)?.length);
  if (!usable.length) return { questionIds: [], skillIds: [], reason: "No published questions on their weak skills yet." };
  // 4 / 3 / 3 over the top three skills (scaled to the size), passing spare places down the list.
  const shares = [Math.ceil(size * 0.4), Math.floor(size * 0.3), size - Math.ceil(size * 0.4) - Math.floor(size * 0.3)];
  const picked: PoolQuestion[] = [];
  const used = new Map<string, number>();
  let carry = 0;
  for (const [i, w] of usable.entries()) {
    const want = (shares[i] ?? 0) + carry;
    const take = bySkill.get(w.skillId)!.slice(0, want);
    picked.push(...take);
    used.set(w.skillId, take.length);
    carry = want - take.length;
    if (picked.length >= size) break;
  }
  // Still short: top up from the weak skills' remaining questions, weakest first.
  for (const w of usable) {
    if (picked.length >= size) break;
    const rest = bySkill.get(w.skillId)!.slice(used.get(w.skillId) ?? 0, (used.get(w.skillId) ?? 0) + (size - picked.length));
    picked.push(...rest);
    used.set(w.skillId, (used.get(w.skillId) ?? 0) + rest.length);
  }
  if (picked.length < AUTO_MIN) return { questionIds: [], skillIds: [], reason: `Only ${picked.length} published question${picked.length === 1 ? "" : "s"} on their weak skills (at least ${AUTO_MIN} needed).` };
  const final = picked.slice(0, size);
  return { questionIds: final.map((q) => q.id), skillIds: usable.filter((w) => final.some((q) => q.skillId === w.skillId)).map((w) => w.skillId) };
}

/** Another question for the same skill, not already in the set (for "Swap"). */
export function swapFor(input: { current: string[]; out: PoolQuestion; pool: PoolQuestion[]; exclude: Set<string>; seen: Set<string> }) {
  const options = input.pool
    .filter((q) => q.skillId === input.out.skillId && q.id !== input.out.id && !input.current.includes(q.id) && !input.exclude.has(q.id))
    .sort((a, b) => Number(input.seen.has(a.id)) - Number(input.seen.has(b.id)) || Math.abs(a.difficulty - input.out.difficulty) - Math.abs(b.difficulty - input.out.difficulty) || a.id.localeCompare(b.id));
  return options[0] ?? null;
}

/** The Monday (UTC) of an instant's week, as YYYY-MM-DD. */
export function weekOf(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
