import "server-only";
import { env } from "./env";
import * as store from "./store";
import type { UserRow } from "./store";
import { HttpError } from "./identity";
import { runTurn, type TurnTrace } from "@/engine/pipeline";
import { OfflineCoachModel } from "@/engine/offline-model";
import { ClaudeCoachModel } from "@/llm/claude-model";
import type { CoachModel, Ledger, Memory } from "@/engine/model";
import { emptyMemory } from "@/engine/model";
import { canPreviewPattern, canStartSession, entitlementsFor, effectiveTier, pipelineTier, type Tier } from "@/engine/entitlements";
import { conceptEmbed, cosine } from "@/engine/embed";
import { findPatterns, evidenceLine, patternQuestion, type Rejection } from "@/engine/patterns";
import { openerOf } from "@/engine/critic-rules";
import { toSecondPerson } from "@/engine/offline-model";
import type { Episode, Move, SessionState } from "@/engine/schema";

// ─── Models ─────────────────────────────────────────────────────────────────

const offline = new OfflineCoachModel();

/** Spec: Claude in production; the offline engine only when no key is configured. */
function modelFor(capped: boolean): CoachModel & { calls?: ClaudeCoachModel["calls"] } {
  if (!env.ANTHROPIC_API_KEY) return offline;
  // A user past their monthly cost cap gets the lighter pipeline on the fast model.
  return new ClaudeCoachModel({ mainModel: capped ? env.COACH_MODEL_FAST : env.COACH_MODEL_MAIN, fastModel: env.COACH_MODEL_FAST, apiKey: env.ANTHROPIC_API_KEY });
}

export const usingOfflineEngine = () => !env.ANTHROPIC_API_KEY;

/** US dollars per million tokens (input, output). Update with the pinned models. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
export function costMicrocents(c: { model: string; input_tokens: number; output_tokens: number }) {
  const [i, o] = PRICES[Object.keys(PRICES).find((k) => c.model.startsWith(k)) ?? "claude-opus-5-5"];
  return (c.input_tokens * i + c.output_tokens * o) * 100;
}

// ─── Account and entitlements ──────────────────────────────────────────────

export async function accountOf(user: UserRow) {
  const completedSessions = await store.countCompletedSessions(user.id);
  const account = { tier: user.tier, trialEndsAt: user.trial_ends_at, completedSessions };
  const tier = effectiveTier(account);
  return { account, tier, entitlements: entitlementsFor(tier), pipeline: pipelineTier(account) };
}

// ─── Memory (spec: "When analysis runs: live, during a session") ───────────

export async function buildMemory(user: UserRow, tier: Tier, state: SessionState, userText: string, excludeSessionId?: string): Promise<Memory> {
  if (!user.memory_enabled) return { ...emptyMemory(), offLimits: user.off_limits };
  const ent = entitlementsFor(tier);
  const sessionIds = ent.memorySessions ? (await store.lastSessionIds(user.id, ent.memorySessions + 1)).filter((id) => id !== excludeSessionId).slice(0, ent.memorySessions) : undefined;
  const episodes = await store.listEpisodes(user.id, { sinceDays: ent.patternLookbackDays, sessionIds });

  const query = [state.slots.event, state.slots.interpretation, userText].filter(Boolean).join(" ");
  const [qv] = await conceptEmbed.embed([query]);
  const scored = episodes
    .map((e) => ({ e, sim: (e.vector ? cosine(qv, e.vector) : 0) + (state.slots.people.some((p) => e.people.includes(p)) ? 0.3 : 0) }))
    .filter((x) => x.sim > 0.35)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5)
    .map((x) => strip(x.e));

  const decisions = await store.patternDecisions(user.id);
  const { shown } = findPatterns(episodes, []);
  const patterns = ent.patterns === "preview" ? [] : shown.filter((c) => decisions.some((d) => d.key === c.key && d.status === "confirmed")).map((c) => ({ id: c.key, theme: decisions.find((d) => d.key === c.key)?.wording ?? c.theme, evidence: evidenceLine(c) }));

  const open = episodes.find((e) => e.strategy_offered && !e.strategy_outcome && e.session_id !== excludeSessionId);
  const recent = await store.recentSessionStates(user.id, 6);
  return {
    episodes: scored,
    patterns,
    openPlan: open ? { episode_id: open.episode_id, if_then: ifThenOf(open.strategy_offered!), event: open.event, people: open.people } : null,
    phrases: recent.flatMap((s) => s.state.memorable_phrases.map((phrase) => ({ phrase, when: s.started_at.toISOString().slice(0, 10) }))).slice(0, 8),
    failedStrategies: episodes.filter((e) => e.strategy_outcome === "tried_didnt_help" && e.strategy_offered).map((e) => e.strategy_offered!),
    offLimits: user.off_limits,
  };
}

const strip = (e: store.StoredEpisode): Episode => {
  const { session_id: _s, vector: _v, ...rest } = e;
  return rest;
};
const ifThenOf = (s: string) => /\bIf\b[^.]*\bthen\b[^.]*\./.exec(s)?.[0] ?? s;

// ─── Session start: limits and the opener ──────────────────────────────────

export async function startSession(user: UserRow) {
  const existing = await store.openSession(user.id);
  if (existing) return { session: existing, messages: await store.sessionMessages(existing.id) };
  const { entitlements, pipeline } = await accountOf(user);
  const check = canStartSession(entitlements, await store.sessionStartsSince(user.id, new Date(Date.now() - 7 * 864e5)));
  if (!check.allowed) throw new HttpError(402, check.message);

  const session = await store.createSession(user.id, pipeline);
  const memory = await buildMemory(user, pipeline, session.state, "", session.id);
  const ledger = await store.recentAssistant(user.id, 40);
  const opener = openingLine(memory, ledger.map((l) => l.text), (await store.countCompletedSessions(user.id)) === 0);
  if (memory.openPlan) {
    session.state.followed_up_plan_id = memory.openPlan.episode_id;
    await store.saveSessionState(session.id, session.state);
  }
  await store.addMessage({ sessionId: session.id, userId: user.id, role: "assistant", text: opener, move: memory.openPlan ? "follow_up" : "question", opener: openerOf(opener) });
  return { session, messages: await store.sessionMessages(session.id) };
}

/**
 * Openers come from context (spec: "Generate openers from context"): the last
 * commitment beats "How are you feeling today?". Variants rotate so the same
 * opener isn't reused within the user's recent sessions.
 */
export function openingLine(memory: Memory, recentReplies: string[], firstEver: boolean): string {
  const used = new Set(recentReplies.map(openerOf));
  const fresh = (xs: string[]) => xs.find((x) => !used.has(openerOf(x))) ?? xs[0];
  if (firstEver) return "What's on your mind? Tell me what happened, even if you're not sure yet what you feel about it.";
  if (memory.openPlan) {
    const who = memory.openPlan.people[0]?.split(":").pop();
    const plan = toSecondPerson(memory.openPlan.if_then.replace(/\bI'll\b/g, "you'd")).replace(/^If\b/, "if");
    return fresh([
      who ? `Before anything else: did you end up talking to ${who}? Last time the plan was ${plan}.` : `Last time the plan was ${plan}. Did you get to try it?`,
      `Quick check on last time's plan: ${plan}. How did it go?`,
    ]);
  }
  return fresh(["What's been on your mind since we last talked?", "What happened today that you'd like to make sense of?", "Where do you want to start today?", "Anything sitting with you that you want to look at?"]);
}

// ─── A turn ────────────────────────────────────────────────────────────────

export type TurnResponse = {
  reply: string;
  messageId: number;
  stage: string;
  crisis: boolean;
  episodeId: string | null;
  patternNotice: { kind: "full" | "preview" | "upsell"; text: string } | null;
};

export async function takeTurn(user: UserRow, sessionId: string, text: string, viaVoice: boolean): Promise<TurnResponse> {
  const session = await store.getSession(user.id, sessionId);
  if (!session || session.ended_at) throw new HttpError(404, "That session has ended. Start a new one.");
  const clean = text.trim().slice(0, 8000);
  if (!clean) throw new HttpError(400, "Say or type something first.");
  if (session.pipeline_tier === "free" && clean.length > 2000) throw new HttpError(413, "Free messages are limited to 2,000 characters. Plus has no length limit.");

  const tier = session.pipeline_tier;
  const ent = entitlementsFor(tier);
  const capped = (await store.monthSpendCents(user.id)) > ent.monthlyModelBudgetCents;
  const model = modelFor(capped);
  const history = (await store.sessionMessages(session.id)).map((m) => ({ role: m.role, text: m.text }));
  const memory = await buildMemory(user, tier, session.state, clean, session.id);
  const recent = await store.recentAssistant(user.id, 30);
  const ledger: Ledger = { replies: recent.map((r) => r.text), moves: recent.map((r) => r.move).filter(Boolean) as Move[], strategies: [] };
  const firstSession = (await store.countCompletedSessions(user.id)) === 0;

  const result = await runTurn(model, { state: session.state, history, userText: clean, memory, ledger }, { fullPipeline: ent.fullPipeline && !capped, deeperChainAnalysis: ent.deeperChainAnalysis, country: user.country, firstSession, voiceMode: viaVoice });

  await store.addMessage({ sessionId: session.id, userId: user.id, role: "user", text: clean, viaVoice });
  const messageId = await store.addMessage({ sessionId: session.id, userId: user.id, role: "assistant", text: result.reply, trace: result.trace as TurnTrace, move: result.trace.plan?.move ?? (result.trace.safety.crisis ? "safety" : null), opener: openerOf(result.reply) });
  await store.saveSessionState(session.id, result.state);
  if ("calls" in model && model.calls) await store.logModelCalls(user.id, model.calls, costMicrocents);

  if (result.state.off_limits.length) await store.updateUser(user.id, { off_limits: [...new Set([...user.off_limits, ...result.state.off_limits])] });
  if (result.planOutcome) {
    const ep = await store.getEpisode(user.id, result.planOutcome.episode_id);
    if (ep) {
      const { session_id, vector, ...e } = ep;
      await store.saveEpisode(user.id, session_id, { ...e, strategy_outcome: result.planOutcome.outcome }, vector, conceptEmbed.name);
    }
  }

  let patternNotice: TurnResponse["patternNotice"] = null;
  if (result.episode && user.memory_enabled) {
    const [vec] = await conceptEmbed.embed([[result.episode.event, result.episode.interpretation, ...result.episode.hypotheses.filter((h) => h.confidence === "user_confirmed").map((h) => h.cause)].filter(Boolean).join(" ")]);
    await store.saveEpisode(user.id, session.id, result.episode, vec, conceptEmbed.name);
    patternNotice = await patternNoticeFor(user, tier);
  }

  return { reply: result.reply, messageId, stage: result.state.stage, crisis: result.trace.safety.crisis, episodeId: result.episode?.episode_id ?? null, patternNotice };
}

/** Background-style re-score after an episode is recorded (spec: "In the background, after each session"). */
async function patternNoticeFor(user: UserRow, tier: Tier): Promise<TurnResponse["patternNotice"]> {
  const ent = entitlementsFor(tier);
  const episodes = await store.listEpisodes(user.id, { sinceDays: ent.patternLookbackDays });
  const decisions = await store.patternDecisions(user.id);
  const { shown } = findPatterns(episodes, decisions.filter((d) => d.status === "rejected") as Rejection[]);
  const fresh = shown.find((c) => !decisions.some((d) => d.key === c.key));
  if (!fresh) return null;
  if (ent.patterns !== "preview") return { kind: "full", text: patternQuestion(fresh, episodes) };
  if (canPreviewPattern(ent, user.last_pattern_preview_at)) {
    await store.updateUser(user.id, { last_pattern_preview_at: new Date(), last_pattern_preview_key: fresh.key });
    return { kind: "preview", text: patternQuestion(fresh, episodes) };
  }
  return { kind: "upsell", text: "We noticed something that connects to earlier sessions. Plus shows the full pattern and the episodes behind it." };
}

// ─── Patterns view ─────────────────────────────────────────────────────────

export async function patternsView(user: UserRow) {
  const { entitlements: ent } = await accountOf(user);
  const episodes = await store.listEpisodes(user.id, { sinceDays: ent.patternLookbackDays });
  const decisions = await store.patternDecisions(user.id);
  const { shown, held } = findPatterns(episodes, decisions.filter((d) => d.status === "rejected") as Rejection[]);
  const view = shown.map((c) => {
    const d = decisions.find((x) => x.key === c.key);
    return {
      key: c.key,
      theme: d?.wording ?? c.theme,
      status: d?.status ?? "new",
      question: patternQuestion(c, episodes),
      evidence: evidenceLine(c),
      feelings: c.feelings.slice(0, 3),
      episodes: episodes.filter((e) => c.episode_ids.includes(e.episode_id)).map((e) => ({ id: e.episode_id, date: e.date, event: e.event })),
    };
  });
  if (ent.patterns === "preview") {
    const allowed = canPreviewPattern(ent, user.last_pattern_preview_at);
    const decided = view.filter((v) => v.status !== "new");
    // This month's preview stays visible; a new one opens next month.
    const preview = allowed ? view.find((v) => v.status === "new") : view.find((v) => v.key === user.last_pattern_preview_key && v.status === "new");
    if (preview && allowed) await store.updateUser(user.id, { last_pattern_preview_at: new Date(), last_pattern_preview_key: preview.key });
    // Free: decided patterns stay visible; one new pattern per month, with a single example.
    const visible = [...decided, ...(preview ? [{ ...preview, episodes: preview.episodes.slice(0, 1) }] : [])];
    return { tier: ent.tier, patterns: visible, lockedCount: view.length - visible.length, building: held.length };
  }
  return { tier: ent.tier, patterns: view, lockedCount: 0, building: held.length };
}
