/**
 * Insights from logged practice tests and Coursebook practice (pure, so the
 * numbers can be checked by hand in tests).
 *
 * A "miss" is any question logged as wrong, skipped or guessed. Only complete
 * logs count toward the dashboard; the redo list shows every logged miss.
 */

export type InsightAttempt = { id: string; testName: string; dateTaken: Date; total: number | null; scoreRw: number | null; scoreMath: number | null; status: "draft" | "complete" };
export type InsightItem = { attemptId: string; result: "correct" | "wrong" | "skipped" | "guessed"; skillId: string | null; errorTypeId: string | null };
export type InsightBankAttempt = { skillId: string | null; correct: boolean; createdAt: Date };
export type SkillInfo = { id: string; name: string; domain: string; section: string };

export type SkillRow = {
  skillId: string;
  name: string;
  domain: string;
  section: string;
  /** Official practice (logged tests). */
  misses: number;
  careless: number;
  conceptGap: number;
  carelessShare: number;
  conceptShare: number;
  /** Coursebook practice (the practice player). */
  practiceAnswered: number;
  practiceWrong: number;
  practiceAccuracy: number | null;
};

const byDate = (a: InsightAttempt, b: InsightAttempt) => a.dateTaken.getTime() - b.dateTaken.getTime() || a.id.localeCompare(b.id);

export function computeInsights(input: { attempts: InsightAttempt[]; items: InsightItem[]; bankAttempts: InsightBankAttempt[]; skills: SkillInfo[]; errorTypes: { id: string; label: string }[] }) {
  const complete = input.attempts.filter((a) => a.status === "complete").sort(byDate);
  const completeIds = new Set(complete.map((a) => a.id));
  const misses = input.items.filter((i) => i.result !== "correct" && completeIds.has(i.attemptId));
  const skill = new Map(input.skills.map((s) => [s.id, s]));

  // Score trend, oldest first.
  const trend = complete.map((a) => ({ id: a.id, testName: a.testName, date: a.dateTaken.toISOString().slice(0, 10), total: a.total, rw: a.scoreRw, math: a.scoreMath }));

  // Misses by skill (official), with the careless / concept-gap split, plus Coursebook practice.
  const rows = new Map<string, SkillRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const s = skill.get(id);
      r = { skillId: id, name: s?.name ?? "Unknown skill", domain: s?.domain ?? "", section: s?.section ?? "", misses: 0, careless: 0, conceptGap: 0, carelessShare: 0, conceptShare: 0, practiceAnswered: 0, practiceWrong: 0, practiceAccuracy: null };
      rows.set(id, r);
    }
    return r;
  };
  for (const m of misses) {
    if (!m.skillId) continue;
    const r = row(m.skillId);
    r.misses += 1;
    if (m.errorTypeId === "careless") r.careless += 1;
    if (m.errorTypeId === "concept-gap") r.conceptGap += 1;
  }
  for (const b of input.bankAttempts) {
    if (!b.skillId) continue;
    const r = row(b.skillId);
    r.practiceAnswered += 1;
    if (!b.correct) r.practiceWrong += 1;
  }
  for (const r of rows.values()) {
    r.carelessShare = r.misses ? r.careless / r.misses : 0;
    r.conceptShare = r.misses ? r.conceptGap / r.misses : 0;
    r.practiceAccuracy = r.practiceAnswered ? (r.practiceAnswered - r.practiceWrong) / r.practiceAnswered : null;
  }
  const bySkill = [...rows.values()].sort((a, b) => b.misses - a.misses || b.practiceWrong - a.practiceWrong || a.name.localeCompare(b.name));

  // Error types per logged test, over time.
  const errorTrend = complete.map((a) => {
    const counts: Record<string, number> = Object.fromEntries(input.errorTypes.map((e) => [e.id, 0]));
    let untagged = 0;
    for (const m of misses) {
      if (m.attemptId !== a.id) continue;
      if (m.errorTypeId && m.errorTypeId in counts) counts[m.errorTypeId] += 1;
      else untagged += 1;
    }
    return { id: a.id, date: a.dateTaken.toISOString().slice(0, 10), testName: a.testName, counts, untagged };
  });

  // Focus next: the top 3 skills by misses in the last 3 complete logs.
  const last3 = new Set(complete.slice(-3).map((a) => a.id));
  const recent = new Map<string, number>();
  for (const m of misses) if (m.skillId && last3.has(m.attemptId)) recent.set(m.skillId, (recent.get(m.skillId) ?? 0) + 1);
  const focus = [...recent.entries()]
    .sort((a, b) => b[1] - a[1] || (skill.get(a[0])?.name ?? "").localeCompare(skill.get(b[0])?.name ?? ""))
    .slice(0, 3)
    .map(([skillId, n]) => ({ skillId, name: skill.get(skillId)?.name ?? "Unknown skill", misses: n }));

  const practice = { answered: input.bankAttempts.length, correct: input.bankAttempts.filter((b) => b.correct).length };
  return { trend, bySkill, errorTrend, focus, practice, totals: { logs: complete.length, misses: misses.length } };
}
