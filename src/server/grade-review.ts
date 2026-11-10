import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { assignmentInScope, classAccess, ClassError, itemInScope, memberWhere, studentInScope } from "./access";
import { audit } from "./programs";

/**
 * Teachers and specialists review the grades Claude gave written answers, for
 * the students and subjects in their scope: confirm each one, or override it.
 * The student sees the reviewed grade; overrides go in the audit log.
 */

export async function aiGradesToReview(userId: string, classId: string, opts: { include?: "pending" | "all" } = {}) {
  const access = await classAccess(userId, classId);
  const students = (await db.classMember.findMany({ where: memberWhere(access), select: { userId: true } })).map((m) => m.userId);
  const rows = await db.assignmentAnswer.findMany({
    where: { assignment: { classId }, userId: { in: students }, gradedBy: { in: ["CLAUDE", "DEMO"] }, ...(opts.include === "all" ? {} : { reviewedAt: null }) },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      response: true,
      score: true,
      aiScore: true,
      verdict: true,
      feedback: true,
      reviewedAt: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
      assignment: { select: { id: true, title: true, section: true, domains: true } },
      item: { select: { label: true, prompt: true, answer: true, section: true, domain: true } },
    },
  });
  return {
    access,
    canGrade: access.role !== "VIEWER",
    answers: rows.filter((r) => assignmentInScope(access, r.assignment) && (!r.item.domain || itemInScope(access, r.item))),
  };
}

/** Confirm Claude's grade (no score given) or override it with a score from 0 to 1 and optional feedback. */
export async function reviewAiGrade(userId: string, answerId: string, input: { score?: number; feedback?: string }, now = new Date()) {
  const ans = await db.assignmentAnswer.findUnique({
    where: { id: answerId },
    select: { id: true, userId: true, score: true, aiScore: true, gradedBy: true, feedback: true, assignment: { select: { classId: true, section: true, domains: true } }, item: { select: { label: true, section: true, domain: true } } },
  });
  if (!ans) throw new NotFoundError("Answer not found");
  let access;
  try {
    access = await classAccess(userId, ans.assignment.classId, "grade");
  } catch (err) {
    if (err instanceof NotFoundError) throw new NotFoundError("Answer not found");
    throw err;
  }
  const visible = assignmentInScope(access, ans.assignment) && (!ans.item.domain || itemInScope(access, ans.item)) && (await studentInScope(access, ans.userId));
  if (!visible) throw new NotFoundError("Answer not found");
  if (!["CLAUDE", "DEMO", "TEACHER"].includes(ans.gradedBy)) throw new ClassError("Only answers Claude graded need review.");
  const override = input.score !== undefined;
  if (override && (!Number.isFinite(input.score) || input.score! < 0 || input.score! > 1)) throw new ClassError("A score is from 0% to 100%.");
  const score = override ? Math.round(input.score! * 100) / 100 : ans.score;
  await db.$transaction(async (tx) => {
    await tx.assignmentAnswer.update({
      where: { id: ans.id },
      data: {
        reviewedById: userId,
        reviewedAt: now,
        ...(override
          ? {
              aiScore: ans.aiScore ?? ans.score,
              score,
              correct: score >= 0.999,
              verdict: score >= 0.999 ? "CORRECT" : score > 0 ? "PARTIAL" : "INCORRECT",
              gradedBy: "TEACHER",
              ...(input.feedback?.trim() ? { feedback: input.feedback.trim().slice(0, 2000) } : {}),
            }
          : {}),
      },
    });
    if (override) {
      await audit(tx, {
        programId: access.programId,
        actorId: userId,
        action: "grade.override",
        targetType: "answer",
        targetId: ans.id,
        summary: `Grade on question ${ans.item.label} changed from ${Math.round(ans.score * 100)}% to ${Math.round(score * 100)}%`,
        before: { score: ans.score },
        after: { score },
      });
    }
  });
}
