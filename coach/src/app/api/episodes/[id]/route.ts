import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { deleteEpisode, getEpisode, saveEpisode } from "@/server/store";
import { conceptEmbed } from "@/engine/embed";
import { Feeling } from "@/engine/schema";

type Ctx = { params: Promise<{ id: string }> };

/** Deleting an episode removes it from every pattern it fed. */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireAdult();
    await deleteEpisode(user.id, (await ctx.params).id);
    return Response.json({ ok: true });
  });
}

const Patch = z.object({ event: z.string().min(1).max(500).optional(), interpretation: z.string().max(500).nullable().optional(), feelings: z.array(Feeling).max(10).optional() });

/** The user can edit any line of the record. */
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireAdult();
    const id = (await ctx.params).id;
    const ep = await getEpisode(user.id, id);
    if (!ep) throw new HttpError(404, "Not found.");
    const p = Patch.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Invalid edit.");
    const { session_id, vector: _v, ...e } = ep;
    const next = { ...e, ...p.data };
    const [vec] = await conceptEmbed.embed([[next.event, next.interpretation].filter(Boolean).join(" ")]);
    await saveEpisode(user.id, session_id, next, vec, conceptEmbed.name);
    return Response.json({ ok: true });
  });
}
