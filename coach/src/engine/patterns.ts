import type { Episode } from "./schema";
import { cosine } from "./embed";

/**
 * Pattern recognition (spec: "Pattern recognition").
 *
 * The app never "senses" a pattern: it counts, compares and then asks.
 *   1. Structured counting over confirmed episode records (the backbone).
 *   2. Semantic clustering over episode vectors (the finder), for themes the
 *      fixed labels miss.
 * A candidate is only shown when it passes the evidence rules below. A model may
 * later write the theme's wording; it never decides whether the pattern exists.
 */

export const MIN_EPISODES = 3;
export const MIN_CONFIRMED = 2;
export const MIN_SITUATIONS = 2;
export const CLUSTER_THRESHOLD = 0.62;

export type EpisodeWithVector = Episode & { vector?: number[] | null };

export type Candidate = {
  /** Stable key: same evidence → same key, so a rejection can be honoured. */
  key: string;
  kind: "cause" | "cluster";
  theme: string;
  episode_ids: string[];
  confirmed_count: number;
  situations: number;
  feelings: { label: string; count: number }[];
  actions: { action: string; count: number }[];
  people: string[];
};

export type Rejection = { key: string; episode_ids: string[] };

export const confirmedCauses = (e: Episode) => e.hypotheses.filter((h) => h.confidence === "user_confirmed").map((h) => h.cause);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** A "situation" is the main person, or failing that the main context. */
const situationOf = (e: Episode) => e.people[0] ?? e.context[0] ?? norm(e.event).split(" ").slice(0, 3).join(" ");

function tally(xs: string[]): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function summarise(key: string, kind: Candidate["kind"], theme: string, eps: Episode[], confirmedIn: (e: Episode) => boolean): Candidate {
  return {
    key,
    kind,
    theme,
    episode_ids: eps.map((e) => e.episode_id).sort(),
    confirmed_count: eps.filter(confirmedIn).length,
    situations: new Set(eps.map(situationOf)).size,
    feelings: tally(eps.flatMap((e) => e.feelings.map((f) => f.label))),
    actions: tally(eps.map((e) => e.action_taken).filter((a): a is string => !!a)).map(({ label, count }) => ({ action: label, count })),
    people: [...new Set(eps.flatMap((e) => e.people))],
  };
}

/** Backbone: group episodes by confirmed cause (with near-duplicate wording merged). */
export function countByCause(episodes: Episode[]): Candidate[] {
  const groups = new Map<string, { label: string; eps: Episode[] }>();
  for (const e of episodes) {
    for (const cause of confirmedCauses(e)) {
      const k = norm(cause);
      const existing = [...groups.keys()].find((g) => g === k || tokenJaccard(g, k) >= 0.6);
      const key = existing ?? k;
      const g = groups.get(key) ?? { label: cause, eps: [] };
      if (!g.eps.includes(e)) g.eps.push(e);
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([k, g]) =>
    summarise(`cause:${k}`, "cause", g.label, g.eps, (e) => confirmedCauses(e).some((c) => norm(c) === k || tokenJaccard(norm(c), k) >= 0.6)),
  );
}

/** Finder: greedy single-pass clustering of episode vectors. */
export function clusterEpisodes(episodes: EpisodeWithVector[], threshold = CLUSTER_THRESHOLD): Candidate[] {
  const withVec = episodes.filter((e) => e.vector && e.vector.some((x) => x !== 0));
  const clusters: { centroid: number[]; eps: EpisodeWithVector[] }[] = [];
  for (const e of withVec) {
    let best: (typeof clusters)[number] | null = null;
    let bestSim = threshold;
    for (const c of clusters) {
      const sim = cosine(c.centroid, e.vector!);
      if (sim >= bestSim) {
        best = c;
        bestSim = sim;
      }
    }
    if (best) {
      best.eps.push(e);
      best.centroid = best.centroid.map((x, i) => (x * (best!.eps.length - 1) + e.vector![i]) / best!.eps.length);
    } else clusters.push({ centroid: [...e.vector!], eps: [e] });
  }
  return clusters
    .filter((c) => c.eps.length >= 2)
    .map((c) => {
      const ids = c.eps.map((e) => e.episode_id).sort();
      const causes = tally(c.eps.flatMap(confirmedCauses));
      const theme = causes[0]?.label ?? c.eps[0].interpretation ?? c.eps[0].event;
      return summarise(`cluster:${ids.join(",")}`, "cluster", theme, c.eps, (e) => confirmedCauses(e).length > 0);
    });
}

export type GateResult = { show: boolean; reasons: string[] };

/** Spec: "Rules before a pattern is shown". */
export function gate(c: Candidate, rejections: Rejection[] = []): GateResult {
  const reasons: string[] = [];
  if (c.episode_ids.length < MIN_EPISODES) reasons.push(`only ${c.episode_ids.length} episodes (need ${MIN_EPISODES})`);
  if (c.confirmed_count < MIN_CONFIRMED) reasons.push(`only ${c.confirmed_count} user-confirmed causes (need ${MIN_CONFIRMED})`);
  if (c.situations < MIN_SITUATIONS) reasons.push(`only ${c.situations} situation(s) (need ${MIN_SITUATIONS})`);
  // Rejected patterns are not re-suggested from the same evidence. New episodes reopen it.
  const rejected = rejections.find((r) => r.key === c.key || sameTheme(r.key, c.key));
  if (rejected && c.episode_ids.every((id) => rejected.episode_ids.includes(id))) reasons.push("rejected by the user on this evidence");
  return { show: reasons.length === 0, reasons };
}

function sameTheme(a: string, b: string) {
  return a.startsWith("cause:") && b.startsWith("cause:") && tokenJaccard(a.slice(6), b.slice(6)) >= 0.6;
}

export function findPatterns(episodes: EpisodeWithVector[], rejections: Rejection[] = []): { shown: Candidate[]; held: (Candidate & { reasons: string[] })[] } {
  const all = [...countByCause(episodes), ...clusterEpisodes(episodes)];
  // A cluster that is the same evidence as a cause group adds nothing.
  const deduped = all.filter((c, i) => c.kind === "cause" || !all.slice(0, i).concat(all.slice(i + 1)).some((o) => o.kind === "cause" && sameSet(o.episode_ids, c.episode_ids)));
  const shown: Candidate[] = [];
  const held: (Candidate & { reasons: string[] })[] = [];
  for (const c of deduped) {
    const g = gate(c, rejections);
    if (g.show) shown.push(c);
    else held.push({ ...c, reasons: g.reasons });
  }
  shown.sort((a, b) => b.confirmed_count - a.confirmed_count || b.episode_ids.length - a.episode_ids.length);
  return { shown, held };
}

const NUM = ["zero", "once", "twice", "three times", "four times", "five times", "six times", "seven times"];

/** Shown as a question with its evidence, never a verdict. */
export function patternQuestion(c: Candidate, episodes: Episode[]): string {
  const n = c.episode_ids.length;
  const times = NUM[n] ?? `${n} times`;
  const feeling = c.feelings[0]?.label;
  const examples = episodes.filter((e) => c.episode_ids.includes(e.episode_id)).slice(0, 2).map((e) => e.event.replace(/\.$/, "").toLowerCase());
  const feelPart = feeling ? `, and each time ${feeling} was in the mix` : "";
  const action = c.actions[0] && c.actions[0].count >= 2 ? ` More than once it ended with you ${c.actions[0].action.toLowerCase()}.` : "";
  return `${cap(times)} now, the cause you landed on was "${c.theme}"${feelPart} (${examples.join("; ")}).${action} Does that ring true as a pattern?`;
}

/** One-line evidence for a pattern, for the "show why" view. */
export function evidenceLine(c: Candidate): string {
  return `${c.episode_ids.length} episodes, ${c.confirmed_count} with a cause you confirmed, across ${c.situations} different situations`;
}

// ─── Profile sections (spec: "The personal profile") ───────────────────────

export type ProfileView = {
  triggers: { text: string; count: number }[];
  confusedFeelings: { pair: [string, string]; count: number }[];
  traps: { trap: string; count: number }[];
  whatHelps: { strategy: string; count: number }[];
};

export function profileFrom(episodes: Episode[]): ProfileView {
  const confirmed = episodes.filter((e) => confirmedCauses(e).length > 0);
  const triggers = tally(confirmed.map((e) => e.context[0] ?? "").filter(Boolean)).map(({ label, count }) => ({ text: label, count }));
  const pairs = new Map<string, number>();
  for (const e of confirmed) {
    const labels = [...new Set(e.feelings.map((f) => f.label))].sort();
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) pairs.set(`${labels[i]}|${labels[j]}`, (pairs.get(`${labels[i]}|${labels[j]}`) ?? 0) + 1);
  }
  const confusedFeelings = [...pairs.entries()].filter(([, n]) => n >= 2).map(([k, count]) => ({ pair: k.split("|") as [string, string], count })).sort((a, b) => b.count - a.count);
  const traps = tally(confirmed.flatMap((e) => e.thinking_traps)).map(({ label, count }) => ({ trap: label, count }));
  const whatHelps = tally(episodes.filter((e) => e.strategy_offered && /helped|tried_helped/.test(e.strategy_outcome ?? "")).map((e) => e.strategy_offered!)).map(({ label, count }) => ({ strategy: label, count }));
  return { triggers, confusedFeelings, traps, whatHelps };
}

function tokenJaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter((w) => w.length > 2));
  const B = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
