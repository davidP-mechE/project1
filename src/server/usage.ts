import { db } from "./db";
import { costUsd } from "@/lib/ai/models";
import type { Call } from "./ai/writer";
import type { UsageFeature } from "@/generated/prisma/client";

/** Record what each Claude API call cost, per user and course (for the usage meter and limits in Phase 10). */
export async function recordUsage(
  ctx: { userId: string; courseId?: string | null; lessonId?: string | null; feature: UsageFeature },
  calls: Call<unknown>[],
) {
  if (calls.length === 0) return;
  await db.usageEvent.createMany({
    data: calls.map((c) => ({
      userId: ctx.userId,
      courseId: ctx.courseId ?? null,
      lessonId: ctx.lessonId ?? null,
      feature: ctx.feature,
      model: c.model,
      inputTokens: c.usage.inputTokens,
      outputTokens: c.usage.outputTokens,
      cacheReadTokens: c.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: c.usage.cacheWriteTokens ?? 0,
      batch: Boolean(c.batch),
      costMicroUsd: Math.round(
        costUsd(c.model, c.usage.inputTokens, c.usage.outputTokens, c.usage.cacheReadTokens ?? 0, c.usage.cacheWriteTokens ?? 0, Boolean(c.batch)) * 1_000_000,
      ),
    })),
  });
}
