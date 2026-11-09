import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

/**
 * Our own feature-use counter (no third-party trackers). Most activity is
 * already in its own table (answers, reviews, tutor messages, tests), and the
 * admin page counts those directly; this records only what isn't stored
 * anywhere else. Never throws: analytics must not break the feature.
 */
export type AnalyticsName = "export_downloaded" | "print_opened" | "search_used";

export async function track(name: AnalyticsName, userId: string | null, props?: Record<string, string | number | boolean>) {
  try {
    await db.analyticsEvent.create({ data: { name, userId, props: props as Prisma.InputJsonValue | undefined } });
  } catch (err) {
    console.warn(`[analytics] couldn't record ${name}:`, err instanceof Error ? err.message : err);
  }
}
