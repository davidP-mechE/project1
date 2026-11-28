import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { takeTurn } from "@/server/coach";

const Body = z.object({ sessionId: z.string().uuid(), text: z.string().min(1).max(20000), voice: z.boolean().optional() });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Say or type something first.");
    return Response.json(await takeTurn(user, p.data.sessionId, p.data.text, !!p.data.voice));
  });
}
