import "server-only";
import crypto from "node:crypto";
import { pool } from "./db";
import { seal, sealJson, unseal, unsealJson } from "./crypto";
import type { Episode, SessionState } from "@/engine/schema";
import { newSessionState } from "@/engine/schema";
import type { Tier } from "@/engine/entitlements";
import type { TurnTrace } from "@/engine/pipeline";

export type UserRow = {
  id: string;
  created_at: Date;
  age_confirmed_at: Date | null;
  tier: Tier;
  trial_ends_at: Date | null;
  country: string;
  memory_enabled: boolean;
  research_consent: boolean;
  off_limits: string[];
  goals: string[];
  last_pattern_preview_at: Date | null;
  last_pattern_preview_key: string | null;
};

type RawUser = Omit<UserRow, "off_limits" | "goals"> & { off_limits: string; goals: string };
const toUser = (r: RawUser): UserRow => ({ ...r, off_limits: unsealJson<string[]>(r.off_limits, []), goals: unsealJson<string[]>(r.goals, []) });

export async function createUser(): Promise<UserRow> {
  const id = crypto.randomUUID();
  const { rows } = await pool.query<RawUser>("INSERT INTO users (id) VALUES ($1) RETURNING *", [id]);
  return toUser(rows[0]);
}

export async function getUser(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<RawUser>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function updateUser(id: string, patch: Partial<Pick<UserRow, "age_confirmed_at" | "tier" | "trial_ends_at" | "country" | "memory_enabled" | "research_consent" | "off_limits" | "goals" | "last_pattern_preview_at" | "last_pattern_preview_key">>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    vals.push(k === "off_limits" || k === "goals" ? sealJson(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return;
  vals.push(id);
  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
}

/** Complete deletion: every row cascades from the user. Backups expire within 30 days. */
export async function deleteUser(id: string) {
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

// ─── Sessions and messages ─────────────────────────────────────────────────

export type SessionRow = { id: string; user_id: string; started_at: Date; ended_at: Date | null; state: SessionState; crisis: boolean; pipeline_tier: Tier };
type RawSession = Omit<SessionRow, "state"> & { state: string };
const toSession = (r: RawSession): SessionRow => ({ ...r, state: unsealJson<SessionState>(r.state, newSessionState()) });

export async function createSession(userId: string, pipelineTier: Tier): Promise<SessionRow> {
  const { rows } = await pool.query<RawSession>("INSERT INTO sessions (id, user_id, state, pipeline_tier) VALUES ($1, $2, $3, $4) RETURNING *", [crypto.randomUUID(), userId, sealJson(newSessionState()), pipelineTier]);
  return toSession(rows[0]);
}

/** The session to continue: open, and started within the last 12 hours. */
export async function openSession(userId: string): Promise<SessionRow | null> {
  const { rows } = await pool.query<RawSession>("SELECT * FROM sessions WHERE user_id = $1 AND ended_at IS NULL AND started_at > now() - interval '12 hours' ORDER BY started_at DESC LIMIT 1", [userId]);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function getSession(userId: string, id: string): Promise<SessionRow | null> {
  const { rows } = await pool.query<RawSession>("SELECT * FROM sessions WHERE id = $1 AND user_id = $2", [id, userId]);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function saveSessionState(id: string, state: SessionState) {
  await pool.query("UPDATE sessions SET state = $1, crisis = crisis OR $2 WHERE id = $3", [sealJson(state), state.crisis, id]);
}

export async function endSession(userId: string, id: string) {
  await pool.query("UPDATE sessions SET ended_at = now() WHERE id = $1 AND user_id = $2 AND ended_at IS NULL", [id, userId]);
}

export async function sessionStartsSince(userId: string, since: Date): Promise<Date[]> {
  const { rows } = await pool.query<{ started_at: Date }>("SELECT started_at FROM sessions WHERE user_id = $1 AND started_at > $2", [userId, since]);
  return rows.map((r) => r.started_at);
}

export async function countCompletedSessions(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND (ended_at IS NOT NULL OR started_at < now() - interval '12 hours')", [userId]);
  return Number(rows[0].n);
}

export type MessageRow = { id: number; session_id: string; role: "user" | "assistant"; text: string; move: string | null; feedback: number | null; created_at: Date; trace?: TurnTrace | null };

export async function addMessage(m: { sessionId: string; userId: string; role: "user" | "assistant"; text: string; trace?: TurnTrace | null; move?: string | null; opener?: string | null; viaVoice?: boolean }): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO messages (session_id, user_id, role, body, trace, move, opener, via_voice) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    [m.sessionId, m.userId, m.role, seal(m.text), m.trace ? sealJson(m.trace) : null, m.move ?? null, m.opener ?? null, m.viaVoice ?? false],
  );
  return Number(rows[0].id);
}

export async function sessionMessages(sessionId: string, withTrace = false): Promise<MessageRow[]> {
  const { rows } = await pool.query("SELECT id, session_id, role, body, trace, move, feedback, created_at FROM messages WHERE session_id = $1 ORDER BY id", [sessionId]);
  return rows.map((r) => ({ id: Number(r.id), session_id: r.session_id, role: r.role, text: unseal(r.body), move: r.move, feedback: r.feedback, created_at: r.created_at, trace: withTrace && r.trace ? unsealJson<TurnTrace | null>(r.trace, null) : undefined }));
}

/** Phrase ledger: the user's last ~30 assistant turns across sessions. */
export async function recentAssistant(userId: string, limit = 30): Promise<{ text: string; move: string | null }[]> {
  const { rows } = await pool.query("SELECT body, move FROM messages WHERE user_id = $1 AND role = 'assistant' ORDER BY id DESC LIMIT $2", [userId, limit]);
  return rows.reverse().map((r) => ({ text: unseal(r.body), move: r.move }));
}

export async function setFeedback(userId: string, messageId: number, value: -1 | 1 | null, reason: string | null) {
  await pool.query("UPDATE messages SET feedback = $1, feedback_reason = $2 WHERE id = $3 AND user_id = $4 AND role = 'assistant'", [value, reason, messageId, userId]);
}

// ─── Episodes ──────────────────────────────────────────────────────────────

export type StoredEpisode = Episode & { session_id: string | null; vector: number[] | null };

export async function saveEpisode(userId: string, sessionId: string | null, e: Episode, vector: number[] | null, embedder: string) {
  await pool.query(
    `INSERT INTO episodes (id, user_id, session_id, date, record, vector, embedder, has_confirmed, has_open_plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, vector = EXCLUDED.vector, has_confirmed = EXCLUDED.has_confirmed, has_open_plan = EXCLUDED.has_open_plan`,
    [e.episode_id, userId, sessionId, e.date, sealJson(e), vector, embedder, e.hypotheses.some((h) => h.confidence === "user_confirmed"), !!e.strategy_offered && !e.strategy_outcome],
  );
}

export async function listEpisodes(userId: string, opts: { sinceDays?: number; sessionIds?: string[] } = {}): Promise<StoredEpisode[]> {
  const where = ["user_id = $1"];
  const vals: unknown[] = [userId];
  if (opts.sinceDays) {
    vals.push(opts.sinceDays);
    where.push(`date > now() - ($${vals.length} || ' days')::interval`);
  }
  if (opts.sessionIds) {
    vals.push(opts.sessionIds);
    where.push(`session_id = ANY($${vals.length})`);
  }
  const { rows } = await pool.query(`SELECT session_id, record, vector FROM episodes WHERE ${where.join(" AND ")} ORDER BY date DESC, created_at DESC`, vals);
  return rows.map((r) => ({ ...unsealJson<Episode>(r.record, {} as Episode), session_id: r.session_id, vector: r.vector }));
}

export async function getEpisode(userId: string, id: string): Promise<StoredEpisode | null> {
  const { rows } = await pool.query("SELECT session_id, record, vector FROM episodes WHERE id = $1 AND user_id = $2", [id, userId]);
  return rows[0] ? { ...unsealJson<Episode>(rows[0].record, {} as Episode), session_id: rows[0].session_id, vector: rows[0].vector } : null;
}

/** Deleting an episode removes it from every pattern it fed (patterns are recomputed from episodes). */
export async function deleteEpisode(userId: string, id: string) {
  await pool.query("DELETE FROM episodes WHERE id = $1 AND user_id = $2", [id, userId]);
  await pool.query("UPDATE patterns SET episode_ids = array_remove(episode_ids, $1) WHERE user_id = $2", [id, userId]);
}

export async function lastSessionIds(userId: string, n: number): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2", [userId, n]);
  return rows.map((r) => r.id);
}

export async function recentSessionStates(userId: string, n: number): Promise<{ started_at: Date; state: SessionState }[]> {
  const { rows } = await pool.query<RawSession>("SELECT * FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2", [userId, n]);
  return rows.map((r) => ({ started_at: r.started_at, state: toSession(r).state }));
}

// ─── Patterns (user decisions only; candidates are computed from episodes) ──

export type PatternDecision = { key: string; status: "confirmed" | "rejected"; wording: string | null; episode_ids: string[] };

export async function patternDecisions(userId: string): Promise<PatternDecision[]> {
  const { rows } = await pool.query("SELECT key, status, wording, episode_ids FROM patterns WHERE user_id = $1", [userId]);
  return rows.map((r) => ({ key: r.key, status: r.status, wording: r.wording ? unseal(r.wording) : null, episode_ids: r.episode_ids }));
}

export async function decidePattern(userId: string, d: PatternDecision) {
  await pool.query(
    `INSERT INTO patterns (user_id, key, status, wording, episode_ids) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, key) DO UPDATE SET status = EXCLUDED.status, wording = EXCLUDED.wording, episode_ids = EXCLUDED.episode_ids, updated_at = now()`,
    [userId, d.key, d.status, d.wording ? seal(d.wording) : null, d.episode_ids],
  );
}

// ─── Check-ins, costs, waitlist ────────────────────────────────────────────

export async function addCheckin(userId: string, kind: "gets_me" | "wellbeing" | "insight", score: number) {
  await pool.query("INSERT INTO checkins (user_id, kind, score) VALUES ($1, $2, $3)", [userId, kind, score]);
}

export async function checkins(userId: string) {
  const { rows } = await pool.query<{ kind: string; score: number; created_at: Date }>("SELECT kind, score, created_at FROM checkins WHERE user_id = $1 ORDER BY created_at", [userId]);
  return rows;
}

export async function logModelCalls(userId: string | null, calls: { role: string; model: string; input_tokens: number; output_tokens: number }[], costOf: (c: { model: string; input_tokens: number; output_tokens: number }) => number) {
  for (const c of calls) await pool.query("INSERT INTO model_calls (user_id, role, model, input_tokens, output_tokens, cost_microcents) VALUES ($1, $2, $3, $4, $5, $6)", [userId, c.role, c.model, c.input_tokens, c.output_tokens, Math.round(costOf(c))]);
}

export async function monthSpendCents(userId: string): Promise<number> {
  const { rows } = await pool.query<{ s: string | null }>("SELECT sum(cost_microcents) AS s FROM model_calls WHERE user_id = $1 AND created_at > date_trunc('month', now())", [userId]);
  return Number(rows[0].s ?? 0) / 1e6;
}

export async function joinWaitlist(email: string, source: string | null) {
  await pool.query("INSERT INTO waitlist (email, source) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING", [email.toLowerCase().trim(), source]);
}

// ─── Export (spec: "view, edit, export and delete everything") ─────────────

export async function exportAll(userId: string) {
  const user = await getUser(userId);
  const { rows: sessions } = await pool.query<RawSession>("SELECT * FROM sessions WHERE user_id = $1 ORDER BY started_at", [userId]);
  const out = [];
  for (const s of sessions) {
    const msgs = await sessionMessages(s.id);
    out.push({ id: s.id, started_at: s.started_at, ended_at: s.ended_at, messages: msgs.map((m) => ({ role: m.role, text: m.text, at: m.created_at })) });
  }
  return {
    exported_at: new Date().toISOString(),
    account: user && { created_at: user.created_at, tier: user.tier, country: user.country, memory_enabled: user.memory_enabled, research_consent: user.research_consent, goals: user.goals, off_limits: user.off_limits },
    sessions: out,
    episodes: (await listEpisodes(userId)).map(({ vector: _v, ...e }) => e),
    pattern_decisions: await patternDecisions(userId),
    checkins: await checkins(userId),
  };
}
