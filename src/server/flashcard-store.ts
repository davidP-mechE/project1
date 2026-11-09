import type { Prisma } from "@/generated/prisma/client";
import type { StoredFlashcard } from "@/lib/ai/lesson-schema";

/**
 * Save a lesson's flashcards WITHOUT throwing away students' review history.
 * Deleting and recreating cards would reset every student's spaced-repetition
 * progress whenever a lesson is regenerated or a typo is fixed, so each
 * incoming card reuses an existing row when it can:
 *   1. same id (the lesson editor sends ids back), else
 *   2. same front text (a regenerated lesson that asks the same thing).
 * Cards that are gone are deleted (their review logs are kept).
 */
export async function syncFlashcards(
  tx: Prisma.TransactionClient,
  lesson: { id: string; courseId: string },
  cards: (StoredFlashcard & { id?: string })[],
  userEdited: boolean,
) {
  const existing = await tx.flashcard.findMany({ where: { lessonId: lesson.id }, select: { id: true, front: true } });
  const byId = new Map(existing.map((c) => [c.id, c]));
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const byFront = new Map<string, string>();
  for (const c of existing) if (!byFront.has(key(c.front))) byFront.set(key(c.front), c.id);
  const used = new Set<string>();

  const plan = cards.map((c, order) => {
    let id = c.id && byId.has(c.id) && !used.has(c.id) ? c.id : undefined;
    if (!id) {
      const match = byFront.get(key(c.front));
      if (match && !used.has(match)) id = match;
    }
    if (id) used.add(id);
    return { id, data: { front: c.front, back: c.back, pageRefs: c.pageRefs, order, userEdited } };
  });

  await tx.flashcard.deleteMany({ where: { lessonId: lesson.id, id: { notIn: [...used] } } });
  for (const p of plan) {
    if (p.id) await tx.flashcard.update({ where: { id: p.id }, data: p.data });
  }
  const fresh = plan.filter((p) => !p.id).map((p) => ({ ...p.data, courseId: lesson.courseId, lessonId: lesson.id }));
  if (fresh.length > 0) await tx.flashcard.createMany({ data: fresh });
}
