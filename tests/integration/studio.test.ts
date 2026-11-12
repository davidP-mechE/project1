import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/server/session", () => ({
  getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
  requireUser: async () => ({ id: session.userId }),
  viewerZone: async () => "UTC",
}));

import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import * as studio from "@/server/studio";
import { syncOwnerRole } from "@/server/roles";
import { ensureReferenceData } from "@/server/seed/reference";
import { GET as fileRoute } from "@/app/api/studio/files/[fileId]/route";
import { POST as uploadRoute } from "@/app/api/studio/lessons/[lessonId]/upload/route";
import { GET as listRoute } from "@/app/api/learn/courses/route";
import { createUser, resetDb } from "../helpers/db";

const PDF = Buffer.from("%PDF-1.4\n%fake but starts right\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const savedOwner = process.env.OWNER_EMAIL;

async function people() {
  const owner = await createUser("Owner");
  const tutor = await createUser("Tutor");
  const student = await createUser("Student");
  process.env.OWNER_EMAIL = owner.email;
  await syncOwnerRole();
  await db.user.update({ where: { id: tutor.id }, data: { role: "TUTOR" } });
  return { owner, tutor, student };
}

const getFile = (id: string) => fileRoute(new Request("http://localhost/x"), { params: Promise.resolve({ fileId: id }) } as never);
function postUpload(lessonId: string, name: string, bytes: Buffer) {
  const body = new FormData();
  body.set("file", new File([new Uint8Array(bytes)], name));
  return uploadRoute(new Request("http://localhost:3000/x", { method: "POST", body, headers: { origin: process.env.APP_URL ?? "http://localhost:3000" } }), { params: Promise.resolve({ lessonId }) } as never);
}

describe("Course Studio", () => {
  beforeEach(async () => {
    await resetDb();
    await db.studioCourse.deleteMany();
    session.userId = null;
  });
  afterAll(() => {
    process.env.OWNER_EMAIL = savedOwner;
  });

  it("seeds two empty draft courses, each with one placeholder unit", async () => {
    await ensureReferenceData();
    const cs = await db.studioCourse.findMany({ orderBy: { title: "asc" }, include: { units: { include: { lessons: true } } } });
    expect(cs.map((c) => [c.title, c.section, c.status, c.visibility, c.units.length, c.units[0].lessons.length])).toEqual([
      ["Advanced EBRW", "ebrw", "draft", "owner_only", 1, 0],
      ["Desmos Masterclass", "math", "draft", "owner_only", 1, 0],
    ]);
  });

  it("new courses are private drafts; only the owner can see or edit them", async () => {
    const { owner, tutor, student } = await people();
    const c = await studio.createCourse(owner.id, { title: "Desmos Masterclass", section: "math" });
    expect([c.status, c.visibility]).toEqual(["draft", "owner_only"]);
    for (const who of [tutor.id, student.id, null]) {
      await expect(studio.courseForViewer(who, c.slug)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(studio.createCourse(tutor.id, { title: "Mine" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(studio.studioCourses(student.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await studio.courseForViewer(owner.id, c.slug)).id).toBe(c.id);
  });

  it("draft files 404 for everyone but the owner (route tested directly); published files reach signed-in users", async () => {
    const { owner, tutor, student } = await people();
    const c = await studio.createCourse(owner.id, { title: "Advanced EBRW", section: "ebrw" });
    const unit = await db.studioUnit.findFirstOrThrow({ where: { courseId: c.id } });
    const lesson = await studio.addLesson(owner.id, unit.id, "Transitions");
    const up = await studio.uploadToLesson(owner.id, lesson.id, "notes.pdf", PDF);
    expect(up.kind).toBe("file");
    const file = await db.studioFile.findFirstOrThrow({ where: { lessonId: lesson.id } });
    expect(file.storageKey.startsWith("studio/")).toBe(true);

    for (const who of [tutor.id, student.id, null]) {
      session.userId = who;
      const r = await getFile(file.id);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(JSON.stringify({ error: "Not found" }));
    }
    session.userId = owner.id;
    expect((await getFile(file.id)).status).toBe(200);
    // Missing ids look exactly the same as drafts.
    session.userId = student.id;
    expect(await (await getFile("does-not-exist")).text()).toBe(JSON.stringify({ error: "Not found" }));

    await studio.publishCourse(owner.id, c.id);
    expect((await getFile(file.id)).status).toBe(200);
    session.userId = null;
    expect((await getFile(file.id)).status).toBe(404); // still never public to signed-out visitors
  });

  it("drafts never appear in the catalog, its search or the JSON list; publishing flips status and visibility together", async () => {
    const { owner, student } = await people();
    const c = await studio.createCourse(owner.id, { title: "Desmos Masterclass", section: "math", description: "graphs" });
    const unit = await db.studioUnit.findFirstOrThrow({ where: { courseId: c.id } });
    session.userId = student.id;
    expect((await (await listRoute(new Request("http://localhost/api/learn/courses"))).json()).courses).toEqual([]);
    expect(await studio.listPublicCourses("Desmos")).toEqual([]);
    session.userId = owner.id;
    expect((await (await listRoute(new Request("http://localhost/api/learn/courses"))).json()).courses).toEqual([]); // the owner's list is the Studio, not the catalog

    await expect(studio.publishCourse(owner.id, c.id)).rejects.toThrow(/at least one lesson/);
    await studio.addLesson(owner.id, unit.id, "Intersections");
    await expect(studio.publishCourse(student.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
    const p = await studio.publishCourse(owner.id, c.id);
    expect([p.status, p.visibility]).toEqual(["published", "public"]);
    expect((await studio.listPublicCourses("graphs")).map((x) => x.id)).toEqual([c.id]);
    expect((await studio.courseForViewer(student.id, c.slug)).id).toBe(c.id);

    const u = await studio.unpublishCourse(owner.id, c.id);
    expect([u.status, u.visibility]).toEqual(["draft", "owner_only"]);
    await expect(studio.courseForViewer(student.id, c.slug)).rejects.toBeInstanceOf(NotFoundError);
    expect(await studio.listPublicCourses()).toEqual([]);
  });

  it("validates uploads with clear errors, and imports question-set JSON as drafts", async () => {
    const { owner, student } = await people();
    const c = await studio.createCourse(owner.id, { title: "Masterclass", section: "math" });
    const unit = await db.studioUnit.findFirstOrThrow({ where: { courseId: c.id } });
    const lesson = await studio.addLesson(owner.id, unit.id, "Systems");
    await expect(studio.uploadToLesson(owner.id, lesson.id, "virus.exe", PDF)).rejects.toThrow(/isn't a type you can upload/);
    await expect(studio.uploadToLesson(owner.id, lesson.id, "fake.pdf", PNG)).rejects.toThrow(/doesn't look like a real PDF/);
    await expect(studio.uploadToLesson(owner.id, lesson.id, "big.png", Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]))).rejects.toThrow(/too large: an image can be at most 5 MB/);
    await expect(studio.uploadToLesson(owner.id, lesson.id, "bad.json", Buffer.from("{nope"))).rejects.toThrow(/valid JSON/);
    expect((await studio.uploadToLesson(owner.id, lesson.id, "pic.png", PNG)).kind).toBe("file");
    expect((await studio.uploadToLesson(owner.id, lesson.id, "intro.md", Buffer.from("# Hi\n$x^2$"))).kind).toBe("markdown");

    const rows = [
      { id: "MC-1", section: "math", skill: "Linear equations in one variable", difficulty: 1, type: "grid-in", stem: "Solve $x+1=2$.", answer: "1", explanation: "Subtract 1." },
      { id: "MC-2", section: "math", skill: "Not a skill", difficulty: 1, type: "grid-in", stem: "?", answer: "1" },
    ];
    const r = await studio.uploadToLesson(owner.id, lesson.id, "set.json", Buffer.from(JSON.stringify(rows)));
    expect(r).toMatchObject({ kind: "question_set", imported: 1, failed: 1 });
    if (r.kind !== "question_set") throw new Error();
    expect(r.problems[0]).toMatchObject({ row: 2, errors: [expect.stringMatching(/Unknown skill/)] });
    expect(await db.bankQuestion.findUniqueOrThrow({ where: { externalId: "MC-1" } })).toMatchObject({ status: "draft", source: "original" });
    expect((await db.questionSet.findUniqueOrThrow({ where: { id: r.setId } })).status).toBe("draft");

    // Through the route: a student's upload is a 404, the owner's works.
    session.userId = student.id;
    expect((await postUpload(lesson.id, "x.md", Buffer.from("hi"))).status).toBe(404);
    session.userId = owner.id;
    expect((await postUpload(lesson.id, "x.md", Buffer.from("hi"))).status).toBe(200);
    expect((await postUpload(lesson.id, "x.txt", Buffer.from("hi"))).status).toBe(400);
  });

  it("students don't see draft question sets inside a published lesson", async () => {
    const { owner, student } = await people();
    const c = await studio.createCourse(owner.id, { title: "Course", section: "math" });
    const unit = await db.studioUnit.findFirstOrThrow({ where: { courseId: c.id } });
    const lesson = await studio.addLesson(owner.id, unit.id, "L");
    const set = await db.questionSet.create({ data: { title: "Draft set", questionIds: [], status: "draft", visibility: "public" } });
    await studio.addBlock(owner.id, lesson.id, { kind: "question_set", setId: set.id });
    await studio.addBlock(owner.id, lesson.id, { kind: "markdown", text: "Hello" });
    await studio.publishCourse(owner.id, c.id);
    expect((await studio.lessonForViewer(student.id, c.slug, lesson.id)).lesson.blocks.map((b) => b.kind)).toEqual(["markdown"]);
    expect((await studio.lessonForViewer(owner.id, c.slug, lesson.id)).lesson.blocks.map((b) => b.kind)).toEqual(["question_set", "markdown"]);
  });

  it("a published Toolkit lesson becomes the link target for its Desmos technique", async () => {
    const { owner } = await people();
    const { toolkitLesson } = await import("@/server/bank");
    const c = await studio.createCourse(owner.id, { title: "Desmos Masterclass", section: "math" });
    const unit = await db.studioUnit.findFirstOrThrow({ where: { courseId: c.id } });
    const lesson = await studio.addLesson(owner.id, unit.id, "Regression");
    await studio.updateLesson(owner.id, lesson.id, { desmosTechnique: "regression" });
    expect(await toolkitLesson("regression")).toBeNull(); // the course is still a draft
    await studio.publishCourse(owner.id, c.id);
    expect(await toolkitLesson("regression")).toEqual({ title: "Regression", href: `/learn/${c.slug}/lessons/${lesson.id}` });
  });
});
