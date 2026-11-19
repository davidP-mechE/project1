import "server-only";
import { BankError, requireAuthor, runImport } from "./bank";
import { ensureAiBudget } from "./limits";
import { recordUsage } from "./usage";
import { AiError } from "./ai/writer";
import { getQuestionReader, type ReadQuestion, type ReaderInput } from "./ai/question-reader";
import { cleanInline, cleanQuestionText, stripChoiceLetter } from "@/lib/bank/clean-text";

/**
 * Question bank → College Board: an author uploads official College Board
 * questions (a PDF, screenshots or pasted text), Claude transcribes them, and
 * the author checks the result before adding the good ones to the bank as
 * drafts with source "college_board". Nothing is saved until they choose Add.
 *
 * Owner and tutors only (the same check as the rest of the bank).
 */

export const MAX_CB_PDF_BYTES = 4_000_000; // under the web host's request size limit; the page splits bigger PDFs
export const MAX_CB_IMAGES = 10;
export const MAX_CB_TEXT = 100_000;
export const MAX_CB_RECORDS = 200;

export type CbRecord = Record<string, string | number | Record<string, string>>;
export type CbPreviewRow = { record: CbRecord; figureNote: string; ok: boolean; errors: string[]; warnings: string[]; alreadyInBank: boolean };

const DIFFICULTY = { easy: 1, medium: 2, hard: 3, unknown: 2 } as const;

/** One transcribed question → an import record (the same fields as the JSON import), cleaned once more. */
export function toRecord(q: ReadQuestion): CbRecord {
  const id = q.cbQuestionId.trim().toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 40);
  const choices = q.type === "mcq" ? q.choices.map((c) => stripChoiceLetter(cleanInline(c))) : [];
  return {
    ...(id ? { external_id: `CB-${id}` } : {}),
    source: "college_board",
    section: q.section,
    skill: q.skill,
    difficulty: DIFFICULTY[q.difficulty],
    type: q.type === "mcq" ? "mcq" : "grid-in",
    stem: cleanQuestionText(q.stem),
    choice_a: choices[0] ?? "",
    choice_b: choices[1] ?? "",
    choice_c: choices[2] ?? "",
    choice_d: choices[3] ?? "",
    answer: cleanInline(q.answer).replace(/^\(?([A-Da-d])\)?\.?$/, "$1"),
    explanation: cleanQuestionText(q.explanation),
  };
}

/** Check records the way the importer will, with plain-language extras for what an upload commonly lacks. */
async function preview(userId: string, records: CbRecord[], notes: string[], difficultyKnown: boolean[]): Promise<CbPreviewRow[]> {
  if (records.length === 0) return [];
  const report = await runImport(JSON.stringify(records), "json", { commit: false, authorId: userId });
  const skipped = new Set(report.skipped.map((s) => s.row));
  return report.rows.map((r, i) => {
    const rec = records[i];
    const errors = [...r.errors];
    const warnings = r.warnings.filter((w) => w !== "No explanation.");
    if (!rec.answer) errors.unshift("The upload doesn't show the correct answer. Add the answer key page, or add this question by hand.");
    if (!rec.explanation) warnings.push("No rationale in the upload: the explanation is empty.");
    if (notes[i]) warnings.push("Has a figure that couldn't be transcribed: add it as an image in the editor after importing.");
    if (!difficultyKnown[i]) warnings.push("Difficulty wasn't labelled; set to medium.");
    if (!rec.external_id) warnings.push("No College Board question ID, so importing it twice would make a duplicate.");
    return { record: rec, figureNote: notes[i] ?? "", ok: errors.length === 0, errors, warnings, alreadyInBank: skipped.has(r.row) };
  });
}

/** Read one upload with Claude. Returns every question found, checked but not saved. */
export async function readCollegeBoardUpload(userId: string, input: ReaderInput) {
  await requireAuthor(userId);
  await ensureAiBudget(userId);
  let result;
  try {
    result = await getQuestionReader().read(input);
  } catch (err) {
    if (err instanceof AiError) {
      await recordUsage({ userId, feature: "QUESTION_IMPORT" }, err.calls);
      throw new BankError(err.userMessage, err.kind === "config" ? 503 : 400);
    }
    throw err;
  }
  await recordUsage({ userId, feature: "QUESTION_IMPORT" }, result.calls);
  const qs = result.value.questions.slice(0, MAX_CB_RECORDS);
  const rows = await preview(
    userId,
    qs.map(toRecord),
    qs.map((q) => (q.hasFigure ? cleanInline(q.figureNote) || "A figure" : "")),
    qs.map((q) => q.difficulty !== "unknown"),
  );
  return { rows, problems: cleanInline(result.value.problems) };
}

/** Add checked questions to the bank as College Board drafts. Rows with problems, or already in the bank, are skipped. */
export async function importCollegeBoardRecords(userId: string, records: CbRecord[]) {
  await requireAuthor(userId);
  if (records.length === 0) throw new BankError("Choose at least one question to add.");
  if (records.length > MAX_CB_RECORDS) throw new BankError(`At most ${MAX_CB_RECORDS} questions at a time.`);
  // Whatever the browser sent, these are College Board questions, cleaned again.
  const clean = records.map((r) => ({
    ...r,
    source: "college_board",
    stem: cleanQuestionText(String(r.stem ?? "")),
    explanation: cleanQuestionText(String(r.explanation ?? "")),
    ...Object.fromEntries(["choice_a", "choice_b", "choice_c", "choice_d"].map((k) => [k, cleanInline(String(r[k] ?? ""))])),
  }));
  return runImport(JSON.stringify(clean), "json", { commit: true, authorId: userId });
}
