import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { endSession } from "@/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = z.object({ sessionId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Missing session.");
    await endSession(user.id, p.data.sessionId);
    return Response.json({ ok: true });
  });
}
