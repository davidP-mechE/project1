import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getCourse, NotFoundError } from "./courses";

/** Load a course for a page, showing the "not found" page instead of crashing. Cached per request (the layout loads it too). */
export const getCourseOr404 = cache(async (userId: string, courseId: string) => {
  try {
    return await getCourse(userId, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
});
