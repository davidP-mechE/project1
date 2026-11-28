import { z } from "zod";
import { handle, HttpError } from "@/server/identity";
import { joinWaitlist } from "@/server/store";

const Body = z.object({ email: z.email().max(200), source: z.string().max(50).optional() });

export async function POST(req: Request) {
  return handle(async () => {
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "That email doesn't look right.");
    await joinWaitlist(p.data.email, p.data.source ?? null);
    return Response.json({ ok: true });
  });
}
