import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { decidePattern, listEpisodes } from "@/server/store";
import { patternsView } from "@/server/coach";
import { findPatterns } from "@/engine/patterns";

export async function GET() {
  return handle(async () => Response.json(await patternsView(await requireAdult())));
}

const Body = z.object({ key: z.string().min(1), action: z.enum(["confirm", "reject", "reword"]), wording: z.string().max(200).optional() });

/** Confirm, reword or reject a pattern. Rejected patterns aren't re-suggested from the same evidence. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Invalid request.");
    const { shown } = findPatterns(await listEpisodes(user.id));
    const c = shown.find((x) => x.key === p.data.key);
    if (!c) throw new HttpError(404, "That pattern no longer has enough evidence behind it.");
    if (p.data.action === "reword" && !p.data.wording?.trim()) throw new HttpError(400, "Write the pattern in your own words.");
    await decidePattern(user.id, { key: c.key, status: p.data.action === "reject" ? "rejected" : "confirmed", wording: p.data.action === "reword" ? p.data.wording!.trim() : null, episode_ids: c.episode_ids });
    return Response.json({ ok: true });
  });
}
