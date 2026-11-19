/**
 * Question statistics and "likely bad question" flags, from answers in the
 * practice player, assigned sets and live runs (all are bank attempts).
 * Pure, so the rules are unit-tested. Only answers to the current version
 * count toward the flags; older versions are shown separately.
 */

export type AnswerRow = { answerGiven: string; correct: boolean; n: number; seconds: number };
export type VersionStats = { attempts: number; correct: number; pct: number | null; avgSeconds: number | null; answers: { answer: string; n: number; correct: boolean }[] };

/** Totals for one version from grouped answers (answer → how many, correct?, total seconds). */
export function summarize(rows: AnswerRow[]): VersionStats {
  const by = new Map<string, { n: number; correct: boolean }>();
  let attempts = 0;
  let correct = 0;
  let seconds = 0;
  for (const r of rows) {
    attempts += r.n;
    if (r.correct) correct += r.n;
    seconds += r.seconds;
    const k = r.answerGiven;
    const cur = by.get(k) ?? { n: 0, correct: r.correct };
    by.set(k, { n: cur.n + r.n, correct: cur.correct || r.correct });
  }
  return {
    attempts,
    correct,
    pct: attempts ? correct / attempts : null,
    avgSeconds: attempts ? Math.round(seconds / attempts) : null,
    answers: [...by.entries()].map(([answer, v]) => ({ answer, ...v })).sort((a, b) => b.n - a.n || a.answer.localeCompare(b.answer)),
  };
}

/** What share answer correctly, by difficulty, that we'd call normal (1 easy … 3 hard). */
export const EXPECTED_CORRECT: Record<number, number> = { 1: 0.75, 2: 0.55, 3: 0.35 };
export const MIN_FOR_FLAGS = 10;
export const REPORTS_FOR_FLAG = 3;

export type Flag = { code: "TOO_HARD" | "WRONG_CHOICE_WINS" | "REPORTED"; text: string };

export function flagsFor(q: { difficulty: number; type: "mcq" | "grid_in" }, current: VersionStats, openReports: number): Flag[] {
  const out: Flag[] = [];
  const expected = EXPECTED_CORRECT[q.difficulty] ?? 0.55;
  if (current.attempts >= MIN_FOR_FLAGS && current.pct !== null && current.pct < expected - 0.3) {
    out.push({ code: "TOO_HARD", text: `Only ${Math.round(current.pct * 100)}% correct for a ${["", "easy", "medium", "hard"][q.difficulty] ?? ""} question (about ${Math.round(expected * 100)}% expected). Check the answer key and wording.` });
  }
  if (q.type === "mcq" && current.attempts >= MIN_FOR_FLAGS) {
    const right = current.answers.filter((a) => a.correct).reduce((n, a) => n + a.n, 0);
    const wrong = current.answers.filter((a) => !a.correct).sort((a, b) => b.n - a.n)[0];
    if (wrong && wrong.n > right) out.push({ code: "WRONG_CHOICE_WINS", text: `More students picked ${wrong.answer} (${wrong.n}) than the right answer (${right}). Is ${wrong.answer} also defensible, or is the key wrong?` });
  }
  if (openReports >= REPORTS_FOR_FLAG) out.push({ code: "REPORTED", text: `${openReports} open reports from students.` });
  return out;
}
