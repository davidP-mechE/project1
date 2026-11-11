import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { enroll, listCatalog } from "@/server/catalog";
import { hubOwner, importSlideCourse } from "@/server/hub-import";
import { getLessonView, regenerateLesson, saveLessonEdits, GenerationError } from "@/server/generation/lessons";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/queue", async (orig) => ({ ...(await orig<typeof import("@/server/queue")>()), enqueueGeneration: async () => {} }));

beforeEach(resetDb);

const PDF = Buffer.from("%PDF-1.4 slides");
const course = (over: Record<string, unknown> = {}) => ({
  version: 1,
  key: "sat-test",
  title: "SAT Test",
  subject: "math",
  description: "Two lessons of slides.",
  pageCount: 3,
  units: [
    {
      title: "Algebra",
      lessons: [
        { title: "1.1 · Lines", pageStart: 1, pageEnd: 2, slides: [{ id: "a", html: '<section style="color:red"><h2>Lines</h2><script>alert(1)</script><p onclick="x()">y = mx + b</p></section>', text: "Lines\ny = mx + b" }, { id: "b", html: "<section><p>Slope $2</p></section>", text: "Slope $2" }] },
        { title: "1.2 · Systems", pageStart: 3, pageEnd: 3, slides: [{ id: "c", html: "<section><p>Two lines</p></section>", text: "Two lines" }] },
      ],
    },
  ],
  ...over,
});

async function admin() {
  const u = await createUser("Site Admin");
  return db.user.update({ where: { id: u.id }, data: { role: "ADMIN" } });
}

describe("adding slide courses to the Hub", () => {
  it("needs a site admin to own them", async () => {
    await createUser();
    await expect(hubOwner()).rejects.toThrow(/no site admin/i);
    const a = await admin();
    expect((await hubOwner()).id).toBe(a.id);
    await expect(hubOwner("someone@else.example")).rejects.toThrow(/No site admin with the email/);
  });

  it("creates a published course of slide lessons, cleaned, with its PDF, and only once", async () => {
    const a = await admin();
    const r = await importSlideCourse(a.id, course(), PDF);
    expect(r).toMatchObject({ status: "created", lessons: 2, slides: 3 });

    const c = await db.course.findUniqueOrThrow({ where: { id: r.courseId }, include: { book: { include: { pages: { orderBy: { pageNumber: "asc" } } } }, lessons: { orderBy: { order: "asc" } }, publishedAs: true } });
    expect(c).toMatchObject({ userId: a.id, title: "SAT Test", status: "ACTIVE", subject: "math", outlineSource: "SLIDES" });
    expect(c.book).toMatchObject({ kind: "SLIDES", status: "READY", pageCount: 3, originalFilename: "sat-test.pdf" });
    expect(c.book.pages.map((p) => p.text)).toEqual(["Lines\ny = mx + b", "Slope $2", "Two lines"]);
    expect((await storage.getBuffer(c.book.storageKey)).toString()).toBe("%PDF-1.4 slides");
    expect(c.lessons.map((l) => [l.title, l.pageStart, l.pageEnd, l.status, l.model])).toEqual([
      ["1.1 · Lines", 1, 2, "READY", "slides"],
      ["1.2 · Systems", 3, 3, "READY", "slides"],
    ]);
    const html = JSON.stringify(c.lessons[0].content);
    expect(html).not.toMatch(/script|onclick|alert/);
    expect(html).toContain("y = mx + b");
    expect(c.publishedAs).toMatchObject({ title: "SAT Test", subject: "math", license: "© The 1600 Project. All rights reserved.", published: true });

    expect(await importSlideCourse(a.id, course(), PDF)).toMatchObject({ status: "exists", courseId: r.courseId });
    expect(await db.course.count()).toBe(1);
  });

  it("rejects bad input before writing anything", async () => {
    const a = await admin();
    await expect(importSlideCourse(a.id, course({ subject: "astrology" }), PDF)).rejects.toThrow();
    await expect(importSlideCourse(a.id, course({ pageCount: 4 }), PDF)).rejects.toThrow(/3 slides/);
    await expect(importSlideCourse(a.id, course(), Buffer.from("not a pdf"))).rejects.toThrow(/PDF/);
    expect(await db.book.count()).toBe(0);
  });

  it("students who add it get the slides; slide lessons can't be rewritten and edits keep the slides", async () => {
    const a = await admin();
    const { entryId } = await importSlideCourse(a.id, course(), PDF);
    const student = await createUser("Student");
    expect((await listCatalog(student.id)).find((e) => e.id === entryId)).toMatchObject({ lessons: 2, pages: 3, kind: "SLIDES" });

    const mine = await enroll(student.id, entryId);
    const lesson = await db.lesson.findFirstOrThrow({ where: { courseId: mine, order: 0 } });
    expect(lesson.model).toBe("slides");
    const view = await getLessonView(student.id, mine, lesson.id);
    expect(view.content?.slides?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(view.content?.explanation).toContain("Slope \\$2");

    // Another student can't open this copy.
    const other = await createUser("Other");
    await expect(getLessonView(other.id, mine, lesson.id)).rejects.toThrow(/not found/i);

    await expect(regenerateLesson(student.id, lesson.id, { mode: "lesson" })).rejects.toThrow(GenerationError);
    await saveLessonEdits(student.id, lesson.id, {
      content: { objectives: ["Graph a line"], explanation: "My notes", workedExamples: [], keyTerms: [], slides: [{ id: "evil", html: "<script>x</script>" }] },
      questions: [],
      flashcards: [],
    });
    const after = await getLessonView(student.id, mine, lesson.id);
    expect(after.content?.explanation).toBe("My notes");
    expect(after.content?.slides?.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("the real SAT course files", () => {
  it("import as SAT Math and SAT EBRW", async () => {
    const a = await admin();
    for (const key of ["sat-math", "sat-ebrw"]) {
      const r = await importSlideCourse(a.id, JSON.parse(readFileSync(`content/hub/${key}.json`, "utf8")), readFileSync(`content/hub/${key}.pdf`));
      expect(r.status).toBe("created");
    }
    const entries = await db.catalogEntry.findMany({ orderBy: { title: "asc" }, select: { title: true, subject: true } });
    expect(entries).toEqual([{ title: "SAT EBRW", subject: "ela" }, { title: "SAT Math", subject: "math" }]);
    expect(await db.lesson.count({ where: { model: "slides" } })).toBe(30);
  }, 60_000);
});
