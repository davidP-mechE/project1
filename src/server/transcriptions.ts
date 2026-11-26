import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { isOwner } from "./roles";
import { collegeBoardAllowed } from "./in-house";
import type { Prisma } from "@/generated/prisma/client";
import type { StoredTranscript } from "./qbank-import";

/**
 * Course Studio → Transcriptions (owner only): image-only Question Bank items
 * that Claude turned into text. Ones that failed a check wait here for review;
 * the owner chooses the text or keeps the image, item by item. Items shown as
 * text can be switched back. Re-importing keeps these choices.
 */

export const TEXT_FILTERS = ["review", "auto_text", "approved_text", "kept_image"] as const;
export type TextFilter = (typeof TEXT_FILTERS)[number];
const PAGE = 20;

async function requireOwnerId(userId: string) {
  if (!(await isOwner(userId))) throw new NotFoundError("Not found");
}

const visible = (): Prisma.BankQuestionWhereInput => (collegeBoardAllowed() ? {} : { source: { not: "college_board" } });

export async function transcriptionCounts(ownerId: string) {
  await requireOwnerId(ownerId);
  const rows = await db.bankQuestion.groupBy({ by: ["textStatus"], where: { ...visible(), textStatus: { not: "none" } }, _count: { _all: true } });
  return Object.fromEntries(TEXT_FILTERS.map((f) => [f, rows.find((r) => r.textStatus === f)?._count._all ?? 0])) as Record<TextFilter, number>;
}

export async function transcriptionList(ownerId: string, filter: TextFilter, page = 1) {
  await requireOwnerId(ownerId);
  const where = { ...visible(), textStatus: filter };
  const [rows, total] = await Promise.all([
    db.bankQuestion.findMany({
      where,
      orderBy: { externalId: "asc" },
      skip: (Math.max(1, page) - 1) * PAGE,
      take: PAGE,
      select: { id: true, externalId: true, section: true, type: true, answer: true, textStatus: true, transcript: true, transcriptIssues: true, skill: { select: { name: true } } },
    }),
    db.bankQuestion.count({ where }),
  ]);
  return {
    total,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    rows: rows.flatMap((r) => (r.transcript ? [{ ...r, versions: r.transcript as unknown as StoredTranscript }] : [])),
  };
}

/** Show this item as text, or keep the image. */
export async function chooseVersion(ownerId: string, questionId: string, choice: "text" | "image") {
  await requireOwnerId(ownerId);
  const q = await db.bankQuestion.findUnique({ where: { id: questionId }, select: { id: true, transcript: true } });
  const stored = q?.transcript as StoredTranscript | null | undefined;
  if (!q || !stored?.text || !stored.image) throw new NotFoundError("Not found");
  const v = choice === "text" ? stored.text : stored.image;
  await db.bankQuestion.update({ where: { id: q.id }, data: { ...v, textStatus: choice === "text" ? "approved_text" : "kept_image" } });
}
