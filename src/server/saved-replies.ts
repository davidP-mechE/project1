import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { ClassError, staffClassIds } from "./access";

/**
 * Saved replies: staff's reusable messages, with placeholders filled in per
 * student when sent ({first_name}, {class}, {due_date}). Personal ones are
 * the owner's only; shared ones belong to a program and every staff member
 * there can use them. The owner edits or deletes; the program admin can also
 * edit or delete shared ones. Students never see them.
 */

const MAX_TITLE = 80;
const MAX_BODY = 4000;
const MAX_PER_PERSON = 100;

/** Programs where this person is staff (teacher, specialist, viewer) or the admin. */
async function staffPrograms(userId: string) {
  const classIds = await staffClassIds(userId);
  if (!classIds.length) return [];
  const rows = await db.class.findMany({ where: { id: { in: classIds } }, distinct: ["programId"], select: { programId: true, program: { select: { name: true, adminId: true } } } });
  return rows.map((r) => ({ id: r.programId, name: r.program.name, isAdmin: r.program.adminId === userId }));
}

export async function listSavedReplies(userId: string) {
  const programs = await staffPrograms(userId);
  if (!programs.length) return { replies: [], programs: [] };
  const rows = await db.savedReply.findMany({
    where: { OR: [{ ownerId: userId, programId: null }, { programId: { in: programs.map((p) => p.id) } }] },
    orderBy: [{ programId: { sort: "asc", nulls: "first" } }, { title: "asc" }],
    select: { id: true, title: true, body: true, programId: true, ownerId: true, owner: { select: { name: true } }, updatedAt: true },
  });
  const admin = new Set(programs.filter((p) => p.isAdmin).map((p) => p.id));
  const name = new Map(programs.map((p) => [p.id, p.name]));
  return {
    programs,
    replies: rows.map((r) => ({ ...r, programName: r.programId ? (name.get(r.programId) ?? null) : null, canEdit: r.ownerId === userId || (r.programId !== null && admin.has(r.programId)) })),
  };
}

function clean(input: { title: string; body: string }) {
  const title = input.title.trim().slice(0, MAX_TITLE);
  const body = input.body.trim();
  if (!title) throw new ClassError("Give the reply a short name.");
  if (!body) throw new ClassError("Write the reply first.");
  if (body.length > MAX_BODY) throw new ClassError(`Replies can be up to ${MAX_BODY.toLocaleString("en-US")} characters.`);
  return { title, body };
}

export async function createSavedReply(userId: string, input: { title: string; body: string; programId?: string | null }) {
  const programs = await staffPrograms(userId);
  if (!programs.length) throw new ClassError("Saved replies are for staff.", 403);
  if (input.programId && !programs.some((p) => p.id === input.programId)) throw new NotFoundError("Program not found");
  if ((await db.savedReply.count({ where: { ownerId: userId } })) >= MAX_PER_PERSON) throw new ClassError(`Up to ${MAX_PER_PERSON} saved replies each.`);
  return db.savedReply.create({ data: { ownerId: userId, programId: input.programId || null, ...clean(input) } });
}

async function editable(userId: string, id: string) {
  const r = await db.savedReply.findUnique({ where: { id }, select: { id: true, ownerId: true, programId: true } });
  if (!r) throw new NotFoundError("Not found");
  if (r.ownerId === userId) return r;
  if (r.programId) {
    const p = (await staffPrograms(userId)).find((x) => x.id === r.programId);
    if (p?.isAdmin) return r;
    if (p) throw new ClassError("Only the person who saved it, or the program admin, can change a shared reply.", 403);
  }
  throw new NotFoundError("Not found");
}

export async function updateSavedReply(userId: string, id: string, input: { title: string; body: string; programId?: string | null }) {
  const r = await editable(userId, id);
  let programId = r.programId;
  if (input.programId !== undefined && r.ownerId === userId) {
    if (input.programId && !(await staffPrograms(userId)).some((p) => p.id === input.programId)) throw new NotFoundError("Program not found");
    programId = input.programId || null;
  }
  return db.savedReply.update({ where: { id: r.id }, data: { ...clean(input), programId } });
}

export async function deleteSavedReply(userId: string, id: string) {
  const r = await editable(userId, id);
  await db.savedReply.delete({ where: { id: r.id } });
}
