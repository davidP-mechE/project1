import "server-only";
import { cache } from "react";
import { db } from "./db";
import { roleOf } from "./roles";
import type { Prisma } from "@/generated/prisma/client";

/**
 * In-house content: the College Board Question Bank import and the courses
 * built on it. ONE rule, here:
 *
 *   - in_house questions, sets and courses are visible only to the owner and to
 *     students and staff of classes the owner marked with `inHouseAccess`.
 *     Everyone else, tutors included, gets "not found".
 *   - ALLOW_COLLEGE_BOARD_CONTENT=false hides every college_board question and
 *     every set containing one, for everyone, the owner included.
 *
 * Every query that lists or opens bank content goes through questionWhere /
 * setWhere / canSeeQuestion / canSeeSet. Images are served only through the
 * access-checked image routes, never from a public URL.
 */

/** The kill switch, read on every request (so flipping it needs no rebuild). Default: on. */
export function collegeBoardAllowed() {
  const v = process.env.ALLOW_COLLEGE_BOARD_CONTENT?.trim().toLowerCase();
  return !v || !["false", "0", "no", "off"].includes(v);
}

export type ContentAccess = { userId: string | null; isOwner: boolean; isAuthor: boolean; inHouse: boolean; collegeBoard: boolean };

/** Is this person in (or on the staff of) a live class with in-house access? */
async function inHouseMember(userId: string) {
  const n = await db.class.count({
    where: { inHouseAccess: true, archivedAt: null, OR: [{ teacherId: userId }, { members: { some: { userId } } }, { staff: { some: { userId } } }] },
  });
  return n > 0;
}

/** What bank content this viewer may see (null: logged out). */
export const contentAccess = cache(async (userId: string | null | undefined): Promise<ContentAccess> => {
  const collegeBoard = collegeBoardAllowed();
  if (!userId) return { userId: null, isOwner: false, isAuthor: false, inHouse: false, collegeBoard };
  const r = await roleOf(userId);
  return { userId, isOwner: r.isOwner, isAuthor: r.isAuthor, inHouse: r.isOwner || (await inHouseMember(userId)), collegeBoard };
});

type Gate = { source: string; audience: string };

export const canSeeContent = (a: ContentAccess, c: Gate) => (a.collegeBoard || c.source !== "college_board") && (a.inHouse || c.audience !== "in_house");

/** Filters for queries: only what this viewer may see. */
export function questionWhere(a: ContentAccess): Prisma.BankQuestionWhereInput {
  return { AND: [a.collegeBoard ? {} : { source: { not: "college_board" } }, a.inHouse ? {} : { audience: "public" }] };
}
export function setWhere(a: ContentAccess): Prisma.QuestionSetWhereInput {
  return { AND: [a.collegeBoard ? {} : { source: { not: "college_board" } }, a.inHouse ? {} : { audience: "public" }] };
}

/** Content a class may use (assign, live runs, suggestions): in-house only in classes with in-house access. */
export function classSetWhere(classInHouse: boolean): Prisma.QuestionSetWhereInput {
  return { AND: [collegeBoardAllowed() ? {} : { source: { not: "college_board" } }, classInHouse ? {} : { audience: "public" }] };
}
export function classQuestionWhere(classInHouse: boolean): Prisma.BankQuestionWhereInput {
  return { AND: [collegeBoardAllowed() ? {} : { source: { not: "college_board" } }, classInHouse ? {} : { audience: "public" }] };
}
export async function classIsInHouse(classId: string) {
  return (await db.class.count({ where: { id: classId, inHouseAccess: true } })) > 0;
}

/** May this viewer edit this question? In-house questions: the owner only. */
export const canEditContent = (a: ContentAccess, c: Gate) => canSeeContent(a, c) && (c.audience !== "in_house" || a.isOwner);

/** Is any of these questions from College Board? (A set's `source` follows its questions.) */
export async function setSourceFor(questionIds: string[]): Promise<"college_board" | "original"> {
  if (questionIds.length === 0) return "original";
  const n = await db.bankQuestion.count({ where: { id: { in: questionIds }, source: "college_board" } });
  return n > 0 ? "college_board" : "original";
}

/** Owner only: mark or unmark a class as a 1600 Project class with in-house access. */
export async function setClassInHouseAccess(actorId: string, classId: string, on: boolean) {
  if (!(await roleOf(actorId)).isOwner) throw new Error("Only the owner can change in-house access.");
  await db.class.update({ where: { id: classId }, data: { inHouseAccess: on } });
}
