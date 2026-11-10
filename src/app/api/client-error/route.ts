import { z } from "zod";
import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { recordError } from "@/server/monitoring";
import { RATE_RULES } from "@/lib/usage/rate-limit";

const Body = z.object({ message: z.string().max(1000), path: z.string().max(500) }).strict();

/** A browser error from a logged-in user's page (message and path only; scrubbed before saving). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const limited = await rateLimit(RATE_RULES.clientReport, session.user.id);
  if (!limited.ok) return jsonError("Too many reports.", 429);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Bad request", 400);
  const id = await recordError({ kind: "client", message: parsed.data.message, path: parsed.data.path });
  return Response.json({ id });
}
