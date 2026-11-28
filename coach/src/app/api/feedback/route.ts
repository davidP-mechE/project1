import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { setFeedback } from "@/server/store";

const Body = z.object({ messageId: z.number().int(), value: z.union([z.literal(1), z.literal(-1), z.null()]), reason: z.string().max(500).nullable().optional() });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Invalid feedback.");
    await setFeedback(user.id, p.data.messageId, p.data.value, p.data.reason ?? null);
    return Response.json({ ok: true });
  });
}
