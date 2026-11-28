import { z } from "zod";
import { handle, HttpError, requireAdult } from "@/server/identity";
import { updateUser } from "@/server/store";
import { env } from "@/server/env";

/**
 * Billing seam. In production, RevenueCat webhooks (App Store, Google Play, Stripe)
 * write the one entitlement record per user; the app never trusts the client.
 * Here: start the 7-day Plus trial, and (development only) switch tiers to test gating.
 */
const Body = z.object({ action: z.enum(["start_trial", "dev_set_tier"]), tier: z.enum(["free", "plus", "advanced"]).optional() });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Invalid request.");
    if (p.data.action === "start_trial") {
      if (user.trial_ends_at) throw new HttpError(409, "The free trial has already been used on this account.");
      await updateUser(user.id, { trial_ends_at: new Date(Date.now() + 7 * 864e5) });
      return Response.json({ ok: true });
    }
    if (env.production) throw new HttpError(403, "Not available.");
    await updateUser(user.id, { tier: p.data.tier ?? "free" });
    return Response.json({ ok: true });
  });
}
