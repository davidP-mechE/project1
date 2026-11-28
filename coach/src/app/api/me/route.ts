import { z } from "zod";
import { currentUser, forgetIdentity, handle, HttpError, requireAdult } from "@/server/identity";
import { deleteUser, updateUser } from "@/server/store";
import { accountOf, usingOfflineEngine } from "@/server/coach";
import { RESOURCES, resourcesFor } from "@/engine/safety";

export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    if (!user) return Response.json({ user: null, resources: resourcesFor("US") });
    const { tier, entitlements, pipeline } = await accountOf(user);
    return Response.json({
      user: { ageConfirmed: !!user.age_confirmed_at, tier, baseTier: user.tier, trialEndsAt: user.trial_ends_at, country: user.country, memoryEnabled: user.memory_enabled, researchConsent: user.research_consent, goals: user.goals, offLimits: user.off_limits },
      entitlements,
      pipeline,
      offlineEngine: usingOfflineEngine(),
      resources: resourcesFor(user.country),
    });
  });
}

const Patch = z.object({
  memoryEnabled: z.boolean().optional(),
  researchConsent: z.boolean().optional(),
  country: z.string().length(2).optional(),
  goals: z.array(z.string().max(200)).max(10).optional(),
  offLimits: z.array(z.string().max(100)).max(30).optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const p = Patch.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new HttpError(400, "Invalid settings.");
    const d = p.data;
    if (d.country && !RESOURCES[d.country.toUpperCase()]) throw new HttpError(400, "That country isn't supported yet.");
    await updateUser(user.id, {
      ...(d.memoryEnabled !== undefined ? { memory_enabled: d.memoryEnabled } : {}),
      ...(d.researchConsent !== undefined ? { research_consent: d.researchConsent } : {}),
      ...(d.country ? { country: d.country.toUpperCase() } : {}),
      ...(d.goals ? { goals: d.goals } : {}),
      ...(d.offLimits ? { off_limits: d.offLimits } : {}),
    });
    return Response.json({ ok: true });
  });
}

/** Delete everything, immediately. */
export async function DELETE() {
  return handle(async () => {
    const user = await currentUser();
    if (user) await deleteUser(user.id);
    await forgetIdentity();
    return Response.json({ ok: true });
  });
}
