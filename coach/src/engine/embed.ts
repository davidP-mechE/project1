/**
 * Embedding interface for the semantic-similarity finder (spec: "Semantic
 * similarity (the finder)").
 *
 * Production should use a hosted embedding model with a no-training data agreement,
 * stored in pgvector. Until a vendor is chosen, `conceptEmbed` gives a small,
 * deterministic, offline vector: words are mapped to shared concepts first, so
 * "left out of the group chat" and "boss decided without asking me" both land
 * near "not considered" even with no words in common.
 */

export type Embedder = { name: string; dims: number; embed(texts: string[]): Promise<number[][]> };

/** Concept lexicon: each concept is a dimension; cue words vote for it. */
const CONCEPTS: Record<string, string[]> = {
  not_considered: ["left out", "excluded", "without me", "without asking", "without inviting", "not invited", "didn't ask", "didn't check", "decided without", "not consulted", "behind my back", "forgot about me", "didn't think about me", "overlooked", "ignored", "considered", "plans changed", "changed the plan", "last minute", "cancelled", "canceled", "without telling"],
  unappreciated: ["thank", "appreciat", "credit", "recogni", "noticed my", "taken for granted", "all the work", "nobody noticed", "effort"],
  criticised: ["critici", "feedback", "judged", "corrected", "told me i was wrong", "nitpick", "complain", "picked apart", "review"],
  control: ["control", "micromanag", "told me what to do", "bossy", "no say", "no choice", "forced", "made me"],
  rejection: ["rejected", "dumped", "ghosted", "ignored my message", "didn't reply", "no reply", "left on read", "turned down", "broke up"],
  failure: ["failed", "mistake", "messed up", "screwed up", "not good enough", "behind", "missed the deadline", "lost the", "bombed"],
  uncertainty: ["don't know what", "uncertain", "waiting to hear", "might", "what if", "unknown", "results", "no idea"],
  overload: ["too much", "deadline", "workload", "busy", "overwhelm", "juggling", "no time", "exhausted", "tired"],
  conflict: ["argument", "argued", "fight", "fought", "yelled", "shouted", "snapped", "row", "disagree"],
  loss: ["died", "passed", "lost", "funeral", "grief", "miss", "gone", "moved away"],
  comparison: ["better than me", "compared", "promotion", "got the", "everyone else", "jealous", "their life"],
  unfairness: ["unfair", "not fair", "double standard", "favour", "favor", "always me", "my turn"],
  boundary: ["said yes", "couldn't say no", "agreed to", "pushed into", "guilt", "obligat", "had to"],
  work: ["boss", "manager", "coworker", "colleague", "meeting", "work", "office", "team", "client", "project"],
  family: ["mum", "mom", "dad", "father", "mother", "sister", "brother", "parents", "family", "grandm", "son", "daughter"],
  friends: ["friend", "group chat", "the group", "mates", "buddy", "party", "weekend plans"],
  romance: ["partner", "boyfriend", "girlfriend", "husband", "wife", "date", "dating", "relationship"],
  sunday: ["sunday", "monday", "weekend ending", "start of the week"],
};
const KEYS = Object.keys(CONCEPTS);

/** Pure function; exported for tests. */
export function conceptVector(text: string): number[] {
  const t = text.toLowerCase();
  const v = KEYS.map((k) => CONCEPTS[k].reduce((n, cue) => n + (t.includes(cue) ? 1 : 0), 0));
  return normalise(v);
}

export const conceptEmbed: Embedder = {
  name: "concept-lexicon-v1",
  dims: KEYS.length,
  async embed(texts) {
    return texts.map(conceptVector);
  },
};

export function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map((x) => x / n) : v;
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}
