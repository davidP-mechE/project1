import { z } from "zod";
import { currentOrNewUser, handle, HttpError } from "@/server/identity";
import { updateUser } from "@/server/store";
import { RESOURCES } from "@/engine/safety";

const Body = z.object({ adult: z.literal(true), country: z.string().length(2).optional() });

/** Age gate (spec: 18+ at launch). Creates the anonymous account on first use. */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "This app is for adults 18 and over.");
    const user = await currentOrNewUser();
    const country = parsed.data.country?.toUpperCase();
    await updateUser(user.id, { age_confirmed_at: new Date(), ...(country && RESOURCES[country] ? { country } : {}) });
    return Response.json({ ok: true });
  });
}
