import "server-only";
import { Pool, type PoolClient } from "pg";
import { env } from "./env";

const g = globalThis as unknown as { coachPool?: Pool };
export const pool = g.coachPool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 });
if (!env.production) g.coachPool = pool;

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
