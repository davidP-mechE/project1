import "server-only";
import { pool } from "./db";
import * as store from "./store";
import type { UserRow } from "./store";
import { unseal } from "./crypto";
import { accountOf } from "./coach";
import { precisionOf, isKnownFeeling } from "@/engine/emotions";
import { confirmedCauses, profileFrom } from "@/engine/patterns";

// ─── History (spec: "Past sessions as short summaries; search by person, feeling or topic") ───

export async function historyView(user: UserRow, q: string) {
  const { rows } = await pool.query<{ id: string; started_at: Date; crisis: boolean }>("SELECT id, started_at, crisis FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 200", [user.id]);
  const episodes = await store.listEpisodes(user.id);
  const needle = q.trim().toLowerCase();
  const out = [];
  for (const s of rows) {
    const eps = episodes.filter((e) => e.session_id === s.id);
    let firstUser = "";
    let allUser = "";
    if (!eps.length) {
      // Unfinished session: summarise from the longest thing the user said, search all of it.
      const m = await pool.query("SELECT body FROM messages WHERE session_id = $1 AND role = 'user' ORDER BY id", [s.id]);
      const texts = m.rows.map((r) => unseal(r.body));
      if (!texts.length) continue;
      firstUser = texts.reduce((a, b) => (b.length > a.length ? b : a), "");
      allUser = texts.join(" ");
    }
    const item = {
      id: s.id,
      date: s.started_at,
      crisis: s.crisis,
      episodes: eps.map((e) => ({ id: e.episode_id, event: e.event, feelings: e.feelings.map((f) => f.label), people: e.people.map((p) => p.split(":").pop()!), confirmed: confirmedCauses(e), plan: e.strategy_offered, outcome: e.strategy_outcome })),
      summary: eps.length ? null : firstUser.slice(0, 140),
    };
    if (needle) {
      const hay = `${JSON.stringify(item)} ${allUser}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    out.push(item);
  }
  return out;
}

// ─── Progress (spec: "Progress people can feel") ───────────────────────────

const monthKey = (d: string | Date) => (typeof d === "string" ? d.slice(0, 7) : d.toISOString().slice(0, 7));

export async function progressView(user: UserRow) {
  const { entitlements } = await accountOf(user);
  const episodes = await store.listEpisodes(user.id);
  const months = [...new Set(episodes.map((e) => monthKey(e.date)))].sort();

  const vocab = months.map((m) => {
    const labels = [...new Set(episodes.filter((e) => monthKey(e.date) === m).flatMap((e) => e.feelings.map((f) => f.label)))];
    const precise = labels.filter((l) => precisionOf(l) >= 2 && isKnownFeeling(l));
    return { month: m, distinct: labels.length, precise: precise.length, words: labels };
  });
  const insights = months.map((m) => ({ month: m, confirmed: episodes.filter((e) => monthKey(e.date) === m && confirmedCauses(e).length).length }));
  const plans = episodes.filter((e) => e.strategy_offered);
  const reported = plans.filter((e) => e.strategy_outcome);
  const tried = reported.filter((e) => e.strategy_outcome?.startsWith("tried"));
  const helped = reported.filter((e) => e.strategy_outcome === "tried_helped");
  const ci = await store.checkins(user.id);

  const moments: string[] = [];
  const [prev, cur] = vocab.slice(-2).length === 2 ? vocab.slice(-2) : [null, vocab[vocab.length - 1]];
  if (cur && prev && cur.precise > prev.precise) moments.push(`You used ${cur.precise} precise feeling words this month, up from ${prev.precise} last month.`);
  else if (cur && cur.precise) moments.push(`You've named ${cur.precise} distinct feelings precisely this month.`);
  if (tried.length) moments.push(`You tried ${tried.length} of the ${reported.length} plans you reported back on${helped.length ? `, and ${helped.length} helped` : ""}.`);
  const totalInsights = insights.reduce((s, i) => s + i.confirmed, 0);
  if (totalInsights) moments.push(`${totalInsights} insight${totalInsights === 1 ? "" : "s"} confirmed so far, each one something you agreed fits.`);
  // Honest when it isn't working (spec: "When someone isn't improving, say so").
  const recentHelped = reported.slice(0, 4).filter((e) => e.strategy_outcome === "tried_helped").length;
  if (reported.length >= 4 && recentHelped === 0) moments.push("The last few plans haven't helped. That's worth saying plainly; next session we'll try a different kind of step.");

  const profile = profileFrom(episodes);
  const base = { tier: entitlements.tier, moments: entitlements.progress === "snapshot" ? moments.slice(0, 1) : moments };
  if (entitlements.progress === "snapshot") return { ...base, snapshotOnly: true as const };
  return {
    ...base,
    snapshotOnly: false as const,
    vocab,
    insights,
    followThrough: { offered: plans.length, reported: reported.length, tried: tried.length, helped: helped.length, recent: plans.slice(0, 8).map((e) => ({ date: e.date, plan: e.strategy_offered, outcome: e.strategy_outcome })) },
    checkins: ci,
    profile,
  };
}
