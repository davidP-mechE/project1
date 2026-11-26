import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/server/session", () => ({
  getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
  requireUser: async () => ({ id: session.userId }),
  viewerZone: async () => "UTC",
}));
vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { syncOwnerRole } from "@/server/roles";
import { ensureReferenceData } from "@/server/seed/reference";
import { BankError, answerPractice, getBankQuestion, listBank, listSets, practiceIntro, practiceState, startPractice, updateQuestion, toRecord } from "@/server/bank";
import { assignQuestionSet, createClass } from "@/server/classes";
import { answerMistake, practiceFor } from "@/server/mistakes";
import { setClassInHouseAccess } from "@/server/in-house";
import { importQuestionBank } from "@/server/qbank-import";
import { importCoursePacket } from "@/server/packet-import";
import * as studio from "@/server/studio";
import { GET as imageRoute } from "@/app/api/bank/qbank/[name]/route";
import { GET as bankListRoute } from "@/app/api/bank/questions/route";
import { GET as learnListRoute } from "@/app/api/learn/courses/route";
import { createUser, resetDb } from "../helpers/db";

/**
 * The in-house College Board import (acceptance tests): who can see the questions, their images,
 * sets and draft courses; an in-house student's practice; the ALLOW_COLLEGE_BOARD_CONTENT switch.
 */

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20, 7)]);
const MATH_ID = "ac472881";
const RW_ID = "84b5125b";

function bankFile() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qbank-"));
  const images = path.join(dir, "qbank_images");
  mkdirSync(images);
  for (const f of [`${MATH_ID}_q.webp`, `${MATH_ID}_r.webp`]) writeFileSync(path.join(images, f), WEBP);
  const json = JSON.stringify({
    format: "coursebook-question-bank",
    format_version: 1,
    source: "college_board",
    source_detail: "SAT Suite Question Bank export, test",
    visibility: "in_house",
    items: [
      { question_id: MATH_ID, source: "college_board", section: "math", domain: "Algebra", skill: "Linear equations in one variable", difficulty: "Hard", type: "spr", correct_answer: ".1764, .1765, 3/17", question_image: `${MATH_ID}_q.webp`, rationale_image: `${MATH_ID}_r.webp`, text_hint: "What is the value of ?", home_lesson: "T-1.1", brand_new_field: true },
      { question_id: RW_ID, section: "reading-writing", skill: "Words in Context", difficulty: "Easy", type: "mcq", correct_answer: "B", stem_text: "Baskets are ______ sweetgrass.", choices: { A: "indicated by", B: "handmade from", C: "represented by", D: "collected with" }, rationale_text: "Choice B is the best answer.", home_lesson: "T-1.1" },
    ],
  });
  return { json, imageDir: images };
}

const PACKET = JSON.stringify({
  format: "coursebook-course-packet",
  format_version: 1,
  course: {
    slug: "sat-test-master",
    title: "SAT Test Course",
    section: "math",
    status: "draft",
    visibility: "owner_only",
    units: [
      {
        id: "T-U1",
        number: 1,
        title: "Algebra",
        summary: "Lines.",
        lessons: [
          {
            id: "T-1.1",
            number: "1.1",
            title: "Linear equations",
            estimated_minutes: 30,
            objectives: ["Solve."],
            blocks: [
              { type: "markdown", content: "Key ideas." },
              { type: "video", provider: "youtube", video_id: "8PrSFbEJXvY", url: "https://www.youtube.com/watch?v=8PrSFbEJXvY", title: "Approved one", review_status: "approved" },
              { type: "video", provider: "youtube", video_id: "gEBv9EUSTe0", url: "https://www.youtube.com/watch?v=gEBv9EUSTe0", title: "Not yet reviewed", review_status: "unreviewed" },
              { type: "checkpoint", title: "Quick check", items: [{ id: "c1", prompt: "2 + 2?", answer: "4", explanation: "Add." }] },
              { type: "mystery_block", content: "?" },
              { type: "question_set", set_id: "T-1.1", title: "1.1 Practice Set", status: "ready", question_ids: [MATH_ID, RW_ID], source: "college_board", visibility: "in_house" },
            ],
          },
        ],
        review_sets: [],
      },
    ],
  },
});

const savedOwner = process.env.OWNER_EMAIL;
const savedSwitch = process.env.ALLOW_COLLEGE_BOARD_CONTENT;

async function fixture() {
  await ensureReferenceData();
  const [owner, tutorOut, tutorIn, studentIn, studentOut] = await Promise.all(["Owner", "Tutor elsewhere", "Tutor in-house", "Student in-house", "Student elsewhere"].map((n) => createUser(n)));
  process.env.OWNER_EMAIL = owner.email;
  await syncOwnerRole();
  await db.user.updateMany({ where: { id: { in: [tutorOut.id, tutorIn.id] } }, data: { role: "TUTOR" } });
  const inHouse = await createClass(tutorIn.id, "1600 Project: Fall");
  const other = await createClass(tutorOut.id, "Another class");
  await setClassInHouseAccess(owner.id, inHouse.id, true);
  await db.classMember.create({ data: { classId: inHouse.id, userId: studentIn.id } });
  await db.classMember.create({ data: { classId: other.id, userId: studentOut.id } });

  const b = bankFile();
  const bank = await importQuestionBank({ json: b.json, imageDir: b.imageDir, commit: true });
  const course = await importCoursePacket({ json: PACKET, commit: true, ownerId: owner.id });
  const set = await db.questionSet.findUniqueOrThrow({ where: { key: "T-1.1" } });
  const math = await db.bankQuestion.findUniqueOrThrow({ where: { externalId: `CB-${MATH_ID}` } });
  const rw = await db.bankQuestion.findUniqueOrThrow({ where: { externalId: `CB-${RW_ID}` } });
  const c = await db.studioCourse.findUniqueOrThrow({ where: { slug: "sat-test-master" }, include: { units: { include: { lessons: true } } } });
  return { owner, tutorOut, tutorIn, studentIn, studentOut, inHouse, other, bank, course, set, math, rw, c, lesson: c.units[0].lessons[0] };
}

const image = (name: string) => imageRoute(new Request("http://localhost/x"), { params: Promise.resolve({ name }) } as never);
const as = (id: string | null) => void (session.userId = id);
async function hidden(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch (err) {
    if (err instanceof NotFoundError) return true;
    throw err;
  }
}

beforeEach(async () => {
  await resetDb();
  await db.questionSet.deleteMany();
  await db.bankQuestion.deleteMany();
  await db.studioCourse.deleteMany();
  as(null);
  process.env.ALLOW_COLLEGE_BOARD_CONTENT = "true";
});
afterAll(() => {
  process.env.OWNER_EMAIL = savedOwner;
  if (savedSwitch === undefined) delete process.env.ALLOW_COLLEGE_BOARD_CONTENT;
  else process.env.ALLOW_COLLEGE_BOARD_CONTENT = savedSwitch;
});

describe("in-house College Board content", () => {
  it("imports the bank and the course with full reports (unknown blocks and fields skipped)", async () => {
    const f = await fixture();
    expect(f.bank).toMatchObject({ items: 2, created: 2, failed: [], bySection: { math: 1, "reading-writing": 1 }, images: { referenced: 2, uploaded: 2, missing: [] } });
    expect(f.course).toMatchObject({ course: "created", units: 1, lessons: 1, sets: 1, questionIds: { referenced: 2, found: 2, missing: [] }, blocksByType: { markdown: 1, video: 2, checkpoint: 1, question_set: 1 } });
    expect(f.course.warnings).toEqual(['T-1.1: unknown block type "mystery_block" (skipped).']);
    expect(f.c).toMatchObject({ status: "draft", visibility: "owner_only" });
    expect(f.set).toMatchObject({ audience: "in_house", source: "college_board", status: "published", questionIds: [f.math.id, f.rw.id] });
    expect(f.math).toMatchObject({ audience: "in_house", source: "college_board", type: "grid_in", answer: ".1764|.1765|3/17", imageIsQuestion: true });
  });

  it("is not found for a visitor, a student outside in-house classes and a tutor outside them (API routes and pages)", async () => {
    const f = await fixture();
    const img = `${MATH_ID}_q.webp`;
    for (const who of [null, f.studentOut.id, f.tutorOut.id]) {
      as(who);
      // The image URL.
      expect((await image(img)).status).toBe(404);
      expect((await image(`${MATH_ID}_r.webp`)).status).toBe(404);
      // The draft course URL (/learn/<slug> and its lessons).
      expect(await hidden(() => studio.courseForViewer(who, "sat-test-master"))).toBe(true);
      expect(await hidden(() => studio.lessonForViewer(who, "sat-test-master", f.lesson.id))).toBe(true);
      expect((await (await learnListRoute(new Request("http://localhost/api/learn/courses"))).json().catch(() => ({ courses: [] }))).courses ?? []).toEqual([]);
      if (!who) continue;
      // The question and any set containing it.
      expect(await hidden(() => getBankQuestion(who, f.math.id))).toBe(true);
      expect(await hidden(() => practiceIntro(who, f.set.id))).toBe(true);
      expect(await hidden(() => startPractice(who, f.set.id))).toBe(true);
    }
    // The bank's JSON API: 404 for students; a tutor outside gets the bank without in-house items.
    as(f.studentOut.id);
    expect((await bankListRoute(new Request("http://localhost/api/bank/questions"))).status).toBe(404);
    as(f.tutorOut.id);
    const list = await (await bankListRoute(new Request("http://localhost/api/bank/questions?q=Baskets"))).json();
    expect(list.total).toBe(0);
    expect((await listSets(f.tutorOut.id)).map((s) => s.id)).not.toContain(f.set.id);
    // Nor can a tutor outside assign it, or assign it to a class without in-house access.
    await expect(assignQuestionSet(f.tutorOut.id, f.other.id, { setId: f.set.id })).rejects.toThrow(/Choose a published set/);
    await expect(assignQuestionSet(f.owner.id, f.other.id, { setId: f.set.id })).rejects.toThrow();
  });

  it("an in-house student can open the set, see images, answer, see rationales; a miss goes to their mistake log", async () => {
    const f = await fixture();
    // Assigned in their class, and also reachable through the course once it's published to in-house classes.
    const a = await assignQuestionSet(f.tutorIn.id, f.inHouse.id, { setId: f.set.id });
    as(f.studentIn.id);
    expect((await practiceIntro(f.studentIn.id, f.set.id, a.id)).count).toBe(2);
    const { sessionId } = await startPractice(f.studentIn.id, f.set.id, { assignmentId: a.id });
    const st = await practiceState(f.studentIn.id, sessionId);
    expect(st.questions.map((q) => [q.id, q.imageIsQuestion])).toEqual([[f.math.id, true], [f.rw.id, false]]);
    const math = st.questions[0];
    expect(math).toMatchObject({ imageUrl: `/api/bank/qbank/${MATH_ID}_q.webp`, stem: "" });
    expect(math.imageAlt).toContain("What is the value of");
    // Images come through the checked route.
    const res = await image(`${MATH_ID}_q.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("private");

    const wrong = await answerPractice(f.studentIn.id, sessionId, f.math.id, "0.18", 30);
    expect(wrong).toMatchObject({ correct: false, correctAnswer: ".1764", rationaleImageUrl: `/api/bank/qbank/${MATH_ID}_r.webp`, explanation: "" });
    const right = await answerPractice(f.studentIn.id, sessionId, f.rw.id, "B", 20);
    expect(right).toMatchObject({ correct: true, explanation: "Choice B is the best answer.", rationaleImageUrl: null });

    // The miss is in the mistake log by question id and skill, and comes back as the same question.
    const m = await db.mistakeItem.findFirstOrThrow({ where: { studentId: f.studentIn.id } });
    expect(m).toMatchObject({ sourceType: "BANK", sourceId: f.math.id, externalId: MATH_ID, skill: "Linear equations in one variable", domain: "algebra", section: "MATH" });
    const p = await practiceFor(f.studentIn.id, m.id);
    expect(p.kind).toBe("bank");
    const again = await answerMistake(f.studentIn.id, m.id, { response: "3/17" });
    expect(again.correct).toBe(true);
    expect(again.feedback?.rationaleImageUrl).toBe(`/api/bank/qbank/${MATH_ID}_r.webp`);

    // In-house staff can see in-house questions but only the owner edits them.
    expect((await getBankQuestion(f.tutorIn.id, f.math.id)).canEdit).toBe(false);
    await expect(updateQuestion(f.tutorIn.id, f.rw.id, toRecord(f.rw))).rejects.toThrow(BankError);
  });

  it("published to in-house classes: members see the course with approved videos only; others still get 404", async () => {
    const f = await fixture();
    await studio.publishCourse(f.owner.id, f.c.id, "in_house");
    const v = await studio.lessonForViewer(f.studentIn.id, "sat-test-master", f.lesson.id);
    const videos = v.lesson.blocks.filter((b) => b.kind === "video").map((b) => (b.data as { title: string }).title);
    expect(videos).toEqual(["Approved one"]);
    expect(Object.keys(v.sets)).toEqual([f.set.id]);
    expect(await studio.courseForViewer(f.studentIn.id, "sat-test-master")).toBeTruthy();
    for (const who of [null, f.studentOut.id, f.tutorOut.id]) expect(await hidden(() => studio.courseForViewer(who, "sat-test-master"))).toBe(true);
    // An in-house student can play the set from the course without an assignment.
    expect((await practiceIntro(f.studentIn.id, f.set.id)).count).toBe(2);
    // Checkpoint self-reports.
    const cp = v.lesson.blocks.find((b) => b.kind === "checkpoint")!;
    await studio.recordCheckpoint(f.studentIn.id, cp.id, "c1", "GOT");
    expect(await studio.checkpointResponses(f.studentIn.id, [cp.id])).toEqual({ [cp.id]: { c1: "GOT" } });
    await expect(studio.recordCheckpoint(f.studentOut.id, cp.id, "c1", "GOT")).rejects.toThrow(NotFoundError);
  });

  it("with ALLOW_COLLEGE_BOARD_CONTENT=false, no College Board item or set appears for anyone, the owner included", async () => {
    const f = await fixture();
    await studio.publishCourse(f.owner.id, f.c.id, "in_house");
    process.env.ALLOW_COLLEGE_BOARD_CONTENT = "false";
    for (const who of [f.owner.id, f.tutorIn.id, f.studentIn.id]) {
      as(who);
      expect((await image(`${MATH_ID}_q.webp`)).status).toBe(404);
      expect(await hidden(() => practiceIntro(who, f.set.id))).toBe(true);
      expect(Object.keys((await studio.lessonForViewer(who, "sat-test-master", f.lesson.id)).sets)).toEqual([]);
    }
    expect(await hidden(() => getBankQuestion(f.owner.id, f.math.id))).toBe(true);
    expect((await listBank(f.owner.id)).total).toBe(0);
    expect(await listSets(f.owner.id)).toEqual([]);
    expect(await studio.studioSets(f.owner.id)).toEqual([]);
    process.env.ALLOW_COLLEGE_BOARD_CONTENT = "true";
    expect((await listBank(f.owner.id)).total).toBe(2);
  });

  it("re-importing keeps video approvals, edits, Studio-added blocks and a reshuffled order", async () => {
    const f = await fixture();
    const blocks = await db.studioBlock.findMany({ where: { lessonId: f.lesson.id }, orderBy: { order: "asc" } });
    const pending = blocks.find((b) => b.kind === "video" && (b.data as { title: string }).title === "Not yet reviewed")!;
    await studio.setVideoStatus(f.owner.id, pending.id, "approved");
    await studio.updateBlock(f.owner.id, pending.id, { kind: "video", url: "https://youtu.be/gEBv9EUSTe0", title: "Renamed by me" });
    await studio.addBlock(f.owner.id, f.lesson.id, { kind: "video", url: "https://www.youtube.com/shorts/-v0dUN21keI", title: "My Desmos guide" });
    await studio.reshuffleSet(f.owner.id, f.set.id);
    const order = (await db.questionSet.findUniqueOrThrow({ where: { id: f.set.id } })).questionIds;

    const again = await importCoursePacket({ json: PACKET, commit: true, ownerId: f.owner.id });
    expect(again.course).toBe("updated");
    const after = await db.studioBlock.findMany({ where: { lessonId: f.lesson.id }, orderBy: { order: "asc" } });
    expect(after).toHaveLength(blocks.length + 1);
    expect(after.find((b) => b.id === pending.id)!.data).toMatchObject({ title: "Renamed by me", reviewStatus: "approved" });
    expect(after.at(-1)!.data).toMatchObject({ title: "My Desmos guide", reviewStatus: "unreviewed" });
    expect((await db.questionSet.findUniqueOrThrow({ where: { id: f.set.id } })).questionIds).toEqual(order);
    expect(await db.questionSet.count({ where: { key: "T-1.1" } })).toBe(1);
    // Videos on the review page, in course order.
    expect((await studio.studioVideos(f.owner.id)).map((v) => v.video.title)).toEqual(["Approved one", "Renamed by me", "My Desmos guide"]);
    const sets = await studio.studioSets(f.owner.id);
    expect(sets[0]).toMatchObject({ count: 2, mix: { easy: 1, medium: 0, hard: 1 } });
    // Only the owner sees the Studio pages' data.
    await expect(studio.studioVideos(f.tutorIn.id)).rejects.toThrow(NotFoundError);
  });
});
