import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError, RateLimitError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { getThread, listThreads, sendMessage, startThread } from "@/server/messages";
import { cleanupAttachments, completeAttachmentUpload, createAttachmentUpload, discardAttachment, readAttachment } from "@/server/message-attachments";
import { storage } from "@/server/storage";
import { createUser, resetDb } from "../helpers/db";

/** Files in conversations: checked by their contents, served only to people who can read the conversation. */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(async () => {
  await resetDb();
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from("%PDF-1.4\n%fake but signed\n%%EOF\n");

async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (err instanceof NotFoundError) return "hidden";
    if (err instanceof RateLimitError) return "limited";
    if (err instanceof ClassError) return err.status === 403 ? "denied" : "invalid";
    throw err;
  }
}

async function fixture() {
  const [admin, teacher, ana, ben, outsider] = await Promise.all(["Admin", "Teacher", "Ana", "Ben", "Out"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  await db.classStaff.create({ data: { classId: c.id, userId: teacher.id, role: "TEACHER", sections: [], domains: [], groupIds: [] } });
  const t = await startThread(teacher.id, { classId: c.id, studentId: ana.id });
  return { admin, teacher, ana, ben, outsider, c, t };
}

/** Upload a file the way the browser does: ask, put the bytes, complete. */
async function attach(userId: string, threadId: string, name: string, type: string, body: Buffer) {
  const { attachmentId } = await createAttachmentUpload(userId, threadId, { filename: name, size: body.length, contentType: type });
  const row = await db.messageAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
  await storage.put(row.fileKey, body, type);
  return { attachmentId, result: await completeAttachmentUpload(userId, attachmentId) };
}

describe("message attachments", () => {
  it("checks the file's real type and size; only the conversation's participants can attach", async () => {
    const f = await fixture();
    expect(await outcome(() => createAttachmentUpload(f.ben.id, f.t.id, { filename: "a.png", size: 10, contentType: "image/png" }))).toBe("hidden");
    expect(await outcome(() => createAttachmentUpload(f.admin.id, f.t.id, { filename: "a.png", size: 10, contentType: "image/png" }))).toBe("denied");
    expect(await outcome(() => createAttachmentUpload(f.ana.id, f.t.id, { filename: "a.gif", size: 10, contentType: "image/gif" }))).toBe("invalid");
    expect(await outcome(() => createAttachmentUpload(f.ana.id, f.t.id, { filename: "a.pdf", size: 10 * 1024 * 1024 + 1, contentType: "application/pdf" }))).toBe("invalid");

    // An HTML page renamed .png is refused and deleted.
    const fake = await attach(f.ana.id, f.t.id, "cute.png", "image/png", Buffer.from("<html><script>alert(1)</script></html>"));
    expect(fake.result).toEqual({ ok: false, error: "That file isn't a real PNG, JPG or PDF." });
    expect(await db.messageAttachment.count()).toBe(0);
    // A PDF named .png is refused too.
    const wrong = await attach(f.ana.id, f.t.id, "scan.png", "image/png", PDF);
    expect(wrong.result.ok).toBe(false);
    // A real PNG is accepted, but the size must match what was declared.
    const { attachmentId } = await createAttachmentUpload(f.ana.id, f.t.id, { filename: "graph.png", size: 999, contentType: "image/png" });
    await storage.put((await db.messageAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).fileKey, PNG, "image/png");
    expect((await completeAttachmentUpload(f.ana.id, attachmentId)).ok).toBe(false);
    const good = await attach(f.ana.id, f.t.id, "graph.png", "image/png", PNG);
    expect(good.result).toMatchObject({ ok: true, attachment: { filename: "graph.png", contentType: "image/png", sizeBytes: PNG.length } });
    // Someone else can't complete or discard it.
    expect(await outcome(() => completeAttachmentUpload(f.teacher.id, good.attachmentId))).toBe("hidden");
    expect(await outcome(() => discardAttachment(f.teacher.id, good.attachmentId))).toBe("hidden");
  });

  it("sends files with a message; the participants and the program admin can open them, no one else", async () => {
    const f = await fixture();
    const img = await attach(f.ana.id, f.t.id, "graph.png", "image/png", PNG);
    const pdf = await attach(f.ana.id, f.t.id, "work.pdf", "application/pdf", PDF);
    // Before sending, only Ana can open it.
    expect(await outcome(() => readAttachment(f.teacher.id, img.attachmentId))).toBe("hidden");
    expect((await readAttachment(f.ana.id, img.attachmentId)).contentType).toBe("image/png");
    // Others' files, or files from another thread, can't be sent.
    expect(await outcome(() => sendMessage(f.teacher.id, f.t.id, "hi", new Date(), [img.attachmentId]))).toBe("invalid");
    const other = await startThread(f.teacher.id, { classId: f.c.id, studentId: f.ben.id });
    const benFile = await attach(f.ben.id, other.id, "b.png", "image/png", PNG);
    expect(await outcome(() => sendMessage(f.ana.id, f.t.id, "hi", new Date(), [benFile.attachmentId]))).toBe("invalid");
    // A message can be just files.
    await sendMessage(f.ana.id, f.t.id, "", new Date(), [img.attachmentId, pdf.attachmentId]);
    expect(await outcome(() => sendMessage(f.ana.id, f.t.id, "", new Date(), []))).toBe("invalid");
    // Already sent: can't be sent again or discarded.
    expect(await outcome(() => sendMessage(f.ana.id, f.t.id, "again", new Date(), [img.attachmentId]))).toBe("invalid");
    expect(await outcome(() => discardAttachment(f.ana.id, img.attachmentId))).toBe("hidden");

    const thread = await getThread(f.teacher.id, f.t.id);
    expect(thread.messages.at(-1)!.attachments.map((a) => a.filename)).toEqual(["graph.png", "work.pdf"]);
    expect((await listThreads(f.teacher.id)).threads[0].preview).toBe("Sent a file");
    for (const who of [f.ana, f.teacher, f.admin]) expect((await readAttachment(who.id, pdf.attachmentId)).body.equals(PDF)).toBe(true);
    for (const who of [f.ben, f.outsider]) expect(await outcome(() => readAttachment(who.id, pdf.attachmentId))).toBe("hidden");
    // The teacher loses access when removed from the class's staff.
    await db.classStaff.deleteMany({ where: { classId: f.c.id, userId: f.teacher.id } });
    expect(await outcome(() => readAttachment(f.teacher.id, pdf.attachmentId))).toBe("hidden");
  });

  it("removes files that are never sent after a day; limits uploads to 30 an hour", async () => {
    const f = await fixture();
    const sent = await attach(f.ana.id, f.t.id, "a.png", "image/png", PNG);
    await sendMessage(f.ana.id, f.t.id, "see", new Date(), [sent.attachmentId]);
    const left = await attach(f.ana.id, f.t.id, "b.png", "image/png", PNG);
    const key = (await db.messageAttachment.findUniqueOrThrow({ where: { id: left.attachmentId } })).fileKey;
    expect(await cleanupAttachments()).toEqual({ removed: 0 });
    expect(await cleanupAttachments(new Date(Date.now() + 25 * 3600_000))).toEqual({ removed: 1 });
    expect(await storage.head(key)).toBeNull();
    expect(await db.messageAttachment.count()).toBe(1);
    await db.messageAttachment.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ threadId: f.t.id, uploaderId: f.teacher.id, fileKey: `x/${i}`, filename: "x.png", contentType: "image/png", sizeBytes: 1 })) });
    expect(await outcome(() => createAttachmentUpload(f.teacher.id, f.t.id, { filename: "c.png", size: 10, contentType: "image/png" }))).toBe("limited");
  });
});
