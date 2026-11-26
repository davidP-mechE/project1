import { z } from "zod";
import type { SkillResolver } from "./import";

/**
 * The in-house College Board Question Bank file ("coursebook-question-bank",
 * version 1): reading it and turning each item into a bank row. Pure, so it
 * can be tested without a database. Unknown fields are ignored.
 *
 * Display rules (src/components/bank/practice-player.tsx):
 *  - an item with question_image is shown as that image (alt text from the
 *    passage, or the math text hint), with A–D buttons or a grid-in box;
 *  - otherwise the passage is shown as text with its choices;
 *  - after answering: rationale_image if present, else rationale_text.
 * Math text hints have no equations (they were lost in text extraction), so
 * they're used for search and alt text only, never shown on the page.
 */

export const QBANK_ID = /^[0-9a-f]{8}$/;
/** Question (_q), rationale (_r) and, cut out of a transcribed question, its figure (_fig). */
export const QBANK_IMAGE = /^[0-9a-f]{8}_(q|r|fig)\.webp$/;
export const qbankImageUrl = (name: string) => `/api/bank/qbank/${name}`;
export const qbankExternalId = (questionId: string) => `CB-${questionId}`;

const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().nullable();

export const QbankItemSchema = z.object({
  question_id: z.string(),
  source: opt(z.string()),
  source_detail: opt(z.string()),
  assessment: opt(z.string()),
  section: z.enum(["math", "reading-writing"]),
  domain: opt(z.string()),
  skill: z.string(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  type: z.enum(["mcq", "spr"]),
  correct_answer: z.string(),
  has_figure: opt(z.boolean()),
  stem_text: opt(z.string()),
  choices: opt(z.record(z.string(), z.string())),
  rationale_text: opt(z.string()),
  question_image: opt(z.string()),
  rationale_image: opt(z.string()),
  text_hint: opt(z.string()),
  rationale_text_hint: opt(z.string()),
  lesson_ids: opt(z.array(z.string())),
  home_lesson: opt(z.string()),
  answer_key_note: opt(z.string()),
});
export type QbankItem = z.infer<typeof QbankItemSchema>;

export const QbankFileSchema = z.object({
  format: z.literal("coursebook-question-bank"),
  format_version: z.literal(1),
  source_detail: opt(z.string()),
  items: z.array(z.unknown()),
});

export type QbankRow = {
  externalId: string;
  source: "college_board";
  sourceDetail: string | null;
  audience: "in_house";
  section: "math" | "rw";
  skillId: string | null;
  difficulty: number;
  type: "mcq" | "grid_in";
  stem: string;
  choices: string[];
  answer: string;
  explanation: string;
  imageUrl: string | null;
  imageIsQuestion: boolean;
  imageAlt: string | null;
  rationaleImageUrl: string | null;
  searchText: string | null;
  lesson: string | null;
  status: "published";
};

const DIFFICULTY = { Easy: 1, Medium: 2, Hard: 3 } as const;

/** "7, 8, and 13" / ".1764, .1765, 3/17" → "7|8|13" (the grader accepts any listed form, and equivalents). */
export function normalizeAcceptedList(answer: string): string {
  return answer
    .split(/[|;]|,(?!\d{3}(?:\D|$))|\s+(?:and|or)\s+/i)
    .map((s) => s.trim().replace(/^(and|or)\s+/i, "").trim())
    .filter(Boolean)
    .join("|");
}

/**
 * The bank's skill name → the site's skill. "Command of Evidence" is one skill in the bank but two on
 * the site: the item's home lesson decides (RW-1.3 is the quantitative lesson; the rest are textual).
 */
export function skillNameFor(item: Pick<QbankItem, "skill" | "home_lesson">): string {
  if (item.skill.trim().toLowerCase() === "command of evidence") {
    return item.home_lesson === "RW-1.3" ? "Command of evidence: quantitative" : "Command of evidence: textual";
  }
  return item.skill;
}

export type QbankParse = { row: QbankRow | null; questionId: string; errors: string[]; images: string[]; note: string | null };

/** Drop NUL and other control characters (keeping tabs and newlines) left by PDF text extraction. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
function stripControl<T>(v: T): T {
  if (typeof v === "string") return v.replace(CONTROL, "") as T;
  if (Array.isArray(v)) return v.map(stripControl) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripControl(x)])) as T;
  return v;
}

/** One item → a bank row, or the reasons it can't be imported. */
export function parseQbankItem(rawInput: unknown, resolveSkill: SkillResolver, fileDetail: string | null = null): QbankParse {
  const raw = stripControl(rawInput);
  const qid = typeof (raw as { question_id?: unknown })?.question_id === "string" ? String((raw as { question_id: string }).question_id) : "?";
  const parsed = QbankItemSchema.safeParse(raw);
  if (!parsed.success) return { row: null, questionId: qid, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`), images: [], note: null };
  const it = parsed.data;
  const errors: string[] = [];
  if (!QBANK_ID.test(it.question_id)) errors.push(`question_id "${it.question_id}" isn't an 8-character College Board ID.`);
  const section = it.section === "math" ? "math" : "rw";
  const skillId = resolveSkill(skillNameFor(it), section);
  if (!skillId) errors.push(`Unknown skill "${it.skill}".`);
  const images = [it.question_image, it.rationale_image].filter((x): x is string => Boolean(x));
  for (const img of images) if (!QBANK_IMAGE.test(img)) errors.push(`Image "${img}" isn't a valid file name.`);

  const type = it.type === "mcq" ? "mcq" : "grid_in";
  let answer = it.correct_answer.trim();
  if (type === "mcq") {
    answer = answer.toUpperCase();
    if (!["A", "B", "C", "D"].includes(answer)) errors.push(`Multiple-choice answer "${it.correct_answer}" isn't A–D.`);
  } else {
    answer = normalizeAcceptedList(answer);
    if (!answer) errors.push("Grid-in answer is empty.");
  }

  const stemText = (it.stem_text ?? "").trim();
  const choices = type === "mcq" && it.choices ? ["A", "B", "C", "D"].map((l) => (it.choices?.[l] ?? "").trim()) : [];
  const imageIsQuestion = Boolean(it.question_image);
  if (!imageIsQuestion) {
    if (!stemText) errors.push("No question image and no stem text.");
    if (type === "mcq" && choices.some((c) => !c)) errors.push("Multiple-choice item without all four choices.");
  }
  const rationaleImage = it.rationale_image ? qbankImageUrl(it.rationale_image) : null;
  const explanation = (it.rationale_text ?? "").trim();
  if (!rationaleImage && !explanation) errors.push("No rationale (image or text).");

  // Math hints: search and alt text only, never shown.
  const hint = (it.text_hint ?? "").trim();
  const searchText = [hint, (it.rationale_text_hint ?? "").trim()].filter(Boolean).join("\n") || null;
  // Screen readers get the passage and the choices (the image shows both).
  const choiceText = choices.some(Boolean) ? choices.map((c, n) => `${"ABCD"[n]}. ${c}`).join("\n") : "";
  const alt = imageIsQuestion ? [stemText || hint || "The question, as printed", choiceText].filter(Boolean).join("\n").slice(0, 4_000) : null;

  if (errors.length) return { row: null, questionId: it.question_id, errors, images, note: it.answer_key_note ?? null };
  return {
    questionId: it.question_id,
    errors: [],
    images,
    note: it.answer_key_note ?? null,
    row: {
      externalId: qbankExternalId(it.question_id),
      source: "college_board",
      sourceDetail: (it.source_detail ?? fileDetail ?? "").trim().slice(0, 200) || null,
      audience: "in_house",
      section,
      skillId,
      difficulty: DIFFICULTY[it.difficulty],
      type,
      // Text items: the passage and question. Image items show the image; their text is the alt text.
      stem: imageIsQuestion ? "" : stemText,
      choices: imageIsQuestion && type === "mcq" ? [] : choices,
      answer,
      explanation: rationaleImage ? "" : explanation,
      imageUrl: it.question_image ? qbankImageUrl(it.question_image) : null,
      imageIsQuestion,
      imageAlt: alt,
      rationaleImageUrl: rationaleImage,
      searchText: [searchText, imageIsQuestion ? stemText : null].filter(Boolean).join("\n") || null,
      lesson: it.home_lesson?.slice(0, 60) ?? null,
      status: "published",
    },
  };
}
