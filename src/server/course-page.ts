import "server-only";
import { notFound } from "next/navigation";
import { getCourse, NotFoundError } from "./courses";

/** Load a course for a page, showing the "not found" page instead of crashing. */
export async function getCourseOr404(userId: string, courseId: string) {
  try {
    return await getCourse(userId, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
