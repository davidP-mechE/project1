import { beforeEach, describe, expect, it, vi } from "vitest";

// Uploads enqueue a background job; in these tests we just record the calls instead of using Redis.
const enqueued = vi.hoisted(() => [] as unknown[]);
vi.mock("@/server/queue", () => ({
  enqueueBookProcessing: async (input: unknown) => {
    enqueued.push(input);
    return { id: "job_test" };
  },
}));
import { db } from "@/server/db";
import { storage, storageKeys } from "@/server/storage";
import {
  completeUpload,
  createUpload,
  deleteAllUserFiles,
  deleteCourse,
  getCourse,
  listCourses,
  NotFoundError,
  RateLimitError,
  renameCourse,
  setCourseArchived,
} from "@/server/courses";
import { MAX_UPLOADS_PER_HOUR } from "@/lib/upload/limits";
import { createUser, resetDb } from "../helpers/db";
import { makePdf } from "../helpers/pdf";

const pdf = makePdf("Chapter 1");

async function uploadFor(userId: string, body: Buffer = pdf, filename = "My_Book.pdf") {
  const created = await createUpload(userId, {
    filename,
    size: body.length,
    contentType: "application/pdf",
    rightsConfirmed: true,
  });
  // Simulate the browser's direct upload to storage.
  await storage.put(storageKeys.bookOriginal(userId, created.bookId), body, "application/pdf");
  return created;
}

beforeEach(resetDb);

describe("upload flow", () => {
  it("creates a book + course, accepts a valid PDF, and moves to PROCESSING", async () => {
    const user = await createUser();
    const { bookId, courseId, upload } = await uploadFor(user.id);
    expect(upload.method).toBe("PUT");
    const result = await completeUpload(user.id, bookId);
    expect(result).toEqual({ ok: true, courseId });
    expect(enqueued.at(-1)).toEqual({ userId: user.id, bookId, courseId });
    const course = await getCourse(user.id, courseId);
    expect(course.title).toBe("My Book");
    expect(course.status).toBe("PROCESSING");
    expect(course.book.status).toBe("UPLOADED");
  });

  it("rejects a non-PDF file, deletes it, and marks the course failed", async () => {
    const user = await createUser();
    const fake = Buffer.from("this is not a pdf at all");
    const { bookId, courseId } = await uploadFor(user.id, fake);
    const result = await completeUpload(user.id, bookId);
    expect(result.ok).toBe(false);
    expect(await storage.head(storageKeys.bookOriginal(user.id, bookId))).toBeNull();
    const course = await getCourse(user.id, courseId);
    expect(course.status).toBe("FAILED");
    expect(course.book.error).toMatch(/isn't a PDF/);
  });

  it("fails if the uploaded size doesn't match what was announced", async () => {
    const user = await createUser();
    const created = await createUpload(user.id, { filename: "a.pdf", size: pdf.length + 10, contentType: "application/pdf", rightsConfirmed: true });
    await storage.put(storageKeys.bookOriginal(user.id, created.bookId), pdf, "application/pdf");
    const result = await completeUpload(user.id, created.bookId);
    expect(result.ok).toBe(false);
  });

  it("fails if the file never arrived", async () => {
    const user = await createUser();
    const created = await createUpload(user.id, { filename: "a.pdf", size: 100, contentType: "application/pdf", rightsConfirmed: true });
    expect(await completeUpload(user.id, created.bookId)).toMatchObject({ ok: false });
  });

  it(`limits uploads to ${MAX_UPLOADS_PER_HOUR} per hour`, async () => {
    const user = await createUser();
    for (let i = 0; i < MAX_UPLOADS_PER_HOUR; i++) {
      await createUpload(user.id, { filename: `b${i}.pdf`, size: 10, contentType: "application/pdf", rightsConfirmed: true });
    }
    await expect(
      createUpload(user.id, { filename: "one-more.pdf", size: 10, contentType: "application/pdf", rightsConfirmed: true }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("privacy: users can only touch their own courses", () => {
  it("hides and protects another user's course", async () => {
    const alice = await createUser("Alice");
    const bob = await createUser("Bob");
    const { bookId, courseId } = await uploadFor(alice.id);

    expect(await listCourses(bob.id, { archived: false })).toEqual([]);
    await expect(getCourse(bob.id, courseId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(renameCourse(bob.id, courseId, "Hacked")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCourseArchived(bob.id, courseId, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCourse(bob.id, courseId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(completeUpload(bob.id, bookId)).rejects.toBeInstanceOf(NotFoundError);

    // Alice's course is untouched.
    const course = await getCourse(alice.id, courseId);
    expect(course.title).toBe("My Book");
    expect(course.archivedAt).toBeNull();
  });
});

describe("library management", () => {
  it("renames, archives and unarchives", async () => {
    const user = await createUser();
    const { courseId } = await uploadFor(user.id);
    await renameCourse(user.id, courseId, "  Circuits   101 ");
    expect((await getCourse(user.id, courseId)).title).toBe("Circuits 101");
    await expect(renameCourse(user.id, courseId, "   ")).rejects.toThrow("Title can't be empty.");

    await setCourseArchived(user.id, courseId, true);
    expect(await listCourses(user.id, { archived: false })).toHaveLength(0);
    expect(await listCourses(user.id, { archived: true })).toHaveLength(1);
    await setCourseArchived(user.id, courseId, false);
    expect(await listCourses(user.id, { archived: false })).toHaveLength(1);
  });

  it("delete removes the course, book and stored file", async () => {
    const user = await createUser();
    const { bookId, courseId } = await uploadFor(user.id);
    await deleteCourse(user.id, courseId);
    expect(await db.book.count()).toBe(0);
    expect(await db.course.count()).toBe(0);
    expect(await storage.head(storageKeys.bookOriginal(user.id, bookId))).toBeNull();
  });

  it("deleting a user removes all their books, courses and files", async () => {
    const user = await createUser();
    const other = await createUser();
    const a = await uploadFor(user.id);
    const b = await uploadFor(other.id);
    await deleteAllUserFiles(user.id);
    await db.user.delete({ where: { id: user.id } });
    expect(await db.course.count({ where: { userId: user.id } })).toBe(0);
    expect(await storage.head(storageKeys.bookOriginal(user.id, a.bookId))).toBeNull();
    // The other user is unaffected.
    expect(await storage.head(storageKeys.bookOriginal(other.id, b.bookId))).not.toBeNull();
  });
});
