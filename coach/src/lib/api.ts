"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

export type Resources = { country: string; emergency: string; crisis: { name: string; contact: string; href: string }[] };
export type Me = {
  user: null | { ageConfirmed: boolean; tier: "free" | "plus" | "advanced"; baseTier: string; trialEndsAt: string | null; country: string; memoryEnabled: boolean; researchConsent: boolean; goals: string[]; offLimits: string[] };
  entitlements?: { tier: string; sessionsPerWeek: number | null; patterns: string; progress: string; weeklyReport: boolean };
  offlineEngine?: boolean;
  resources: Resources;
};
