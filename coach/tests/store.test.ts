import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against the test database (it gets wiped). Skipped if none is configured.
const url = process.env.TEST_DATABASE_URL ?? "postgresql://coach:coach@localhost:5432/coach_test";
process.env.DATABASE_URL = url;

const run = process.env.SKIP_DB_TESTS ? describe.skip : describe;

run("store (integration)", () => {
  let store: typeof import("@/server/store");
  let pool: import("pg").Pool;
  beforeAll(async () => {
    store = await import("@/server/store");
    pool = (await import("@/server/db")).pool;
    await pool.query("TRUNCATE users, waitlist CASCADE");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("encrypts conversation text at rest", async () => {
    const u = await store.createUser();
    const s = await store.createSession(u.id, "free");
    await store.addMessage({ sessionId: s.id, userId: u.id, role: "user", text: "My friend Jordan left me out" });
    const raw = await pool.query("SELECT body FROM messages WHERE session_id = $1", [s.id]);
    expect(raw.rows[0].body).not.toContain("Jordan");
    expect((await store.sessionMessages(s.id))[0].text).toBe("My friend Jordan left me out");
    const rawState = await pool.query("SELECT state FROM sessions WHERE id = $1", [s.id]);
    expect(rawState.rows[0].state.startsWith("v1:")).toBe(true);
  });

  it("deleting an episode removes it from every pattern it fed", async () => {
    const u = await store.createUser();
    const ep = (id: string) => ({ episode_id: id, date: "2027-01-01", event: "e", people: [], context: [], feelings: [], interpretation: null, thinking_traps: [], hypotheses: [{ cause: "c", confidence: "user_confirmed" as const }], action_taken: null, strategy_offered: null, strategy_outcome: null });
    for (const id of ["e1", "e2", "e3"]) await store.saveEpisode(u.id, null, ep(id), [1, 0], "test");
    await store.decidePattern(u.id, { key: "cause:c", status: "confirmed", wording: "my words", episode_ids: ["e1", "e2", "e3"] });
    await store.deleteEpisode(u.id, "e2");
    expect((await store.listEpisodes(u.id)).map((e) => e.episode_id).sort()).toEqual(["e1", "e3"]);
    expect((await store.patternDecisions(u.id))[0].episode_ids).toEqual(["e1", "e3"]);
    expect((await store.patternDecisions(u.id))[0].wording).toBe("my words");
  });

  it("exports everything and deletes everything", async () => {
    const u = await store.createUser();
    const s = await store.createSession(u.id, "plus");
    await store.addMessage({ sessionId: s.id, userId: u.id, role: "assistant", text: "What happened?" });
    await store.addCheckin(u.id, "gets_me", 2);
    const data = await store.exportAll(u.id);
    expect(data.sessions[0].messages[0].text).toBe("What happened?");
    expect(data.checkins).toHaveLength(1);
    await store.deleteUser(u.id);
    for (const t of ["sessions", "messages", "episodes", "patterns", "checkins"]) {
      const r = await pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.id]);
      expect(r.rows[0].n, t).toBe(0);
    }
  });

  it("other users can't read a session", async () => {
    const a = await store.createUser();
    const b = await store.createUser();
    const s = await store.createSession(a.id, "free");
    expect(await store.getSession(b.id, s.id)).toBeNull();
  });
});
