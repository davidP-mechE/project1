import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { addCheckin } from "@/server/store";

const Body = z.object({ kind: z.enum(["gets_me", "wellbeing", "insight"]), score: z.number().int().min(0).max(70) });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Invalid check-in.");
    await addCheckin(user.id, p.data.kind, p.data.score);
    return Response.json({ ok: true });
  });
}
