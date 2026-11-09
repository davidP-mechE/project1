import { db } from "@/server/db";

/** Wipe all rows between tests (order doesn't matter with CASCADE). */
export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "user", "session", "account", "verification", "Book", "Course", "Page", "Figure", "Chunk", "Unit", "Lesson", "Job", "Question", "Flashcard", "UsageEvent" RESTART IDENTITY CASCADE`,
  );
}

let n = 0;
export async function createUser(name = "Test User") {
  n += 1;
  return db.user.create({
    data: { id: `user_${Date.now()}_${n}`, name, email: `user${n}_${Date.now()}@example.com`, emailVerified: true },
  });
}
