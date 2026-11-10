import { z } from "zod";
import { cleanTags, DOMAINS } from "@/lib/sat/domains";

/**
 * Reading a teacher's worksheet (a PDF of questions: homework, a problem set,
 * a practice test) into questions students can answer in the app. Claude sees
 * every page as an image (so equations, tables and diagrams survive) plus its
 * extracted text, and lists each question with its answer: from the
 * worksheet's own answer key when there is one, otherwise worked out (and
 * marked for the teacher to check).
 */

export const WORKSHEET_PROMPT_VERSION = "worksheet-v2";

const DOMAIN_LIST = DOMAINS.map((d) => `- ${d.id} (${d.section === "MATH" ? "Math" : "Reading and Writing"}: ${d.name}). Skills: ${d.skills.join("; ")}`).join("\n");
export const MAX_WORKSHEET_PAGES = 20;
export const MAX_WORKSHEET_ITEMS = 120;

export const WORKSHEET_SYSTEM_PROMPT = `You turn teachers' worksheets into questions for Coursebook, an app where students do their assigned work.

You receive every page of one worksheet (a PDF of questions: homework, a problem set, a quiz or a practice test), each as an image and as extracted text marked "=== Page 3 ===". The images are the truth; the text can have broken equations.

<what_to_list>
- List every question a student is meant to answer, in order. Keep the worksheet's numbering as "label" ("1", "2", "4b"). A question with parts (a), (b)… becomes one item per part, labelled "4a", "4b", with the shared stem repeated at the start of each part's prompt.
- Leave out instructions, headers, name/date lines, worked examples, and the answer key itself.
- prompt: the question exactly as written (Markdown). Include any passage, table or data it needs (copy a short passage; for a long reading passage shared by several questions, include it in the first of them and write "Use the passage from question N." in the others). Write all math in LaTeX: $...$ inline, $$...$$ displayed. Describe a figure or graph the student needs as [Figure: what it shows, with its labels and values].
- Never invent questions, data or numbers that aren't on the pages.
</what_to_list>

<types_and_answers>
- multiple_choice: the worksheet gives answer options. "choices" lists them in order without their letters; correctChoice is the 0-based index of the right one.
- short_answer: answered in a word, number, expression or a few sentences. step_by_step: a calculation or procedure to work through; "steps" is the full worked solution, one step per item.
- For questions that aren't multiple choice, use an empty choices list and correctChoice -1. For questions that aren't step-by-step, use an empty steps list.
- answer: the correct answer (for multiple choice, the text of the right option). "explanation" says why it's right, so a student who got it wrong can learn from it.
- answerFromWorksheet: true when the worksheet itself gives the answer (an answer key, a solutions page, or answers marked on it); then use that answer. Otherwise work the answer out carefully yourself and set it to false: the teacher will check it.
- An open-ended question (an essay, a drawing, an opinion) is short_answer; its "answer" describes what a good answer includes.
- topic: the skill being practised, 2–5 words, like "Linear equations", "Ratios and rates", "Words in context", "Command of evidence", "Subject-verb agreement". Use the same name for questions practising the same skill.
</types_and_answers>

<sat_tags>
Tag each question with the digital SAT content domain and skill it practises, so reports can be grouped and staff can be given subjects:
${DOMAIN_LIST}
- satDomain: one of the ids above, or "none" when the question isn't SAT-style Math or Reading and Writing.
- satSkill: the skill name from that domain's list, exactly as written ("" when satDomain is "none").
- difficulty: "easy", "medium" or "hard" for a typical SAT student.
- desmosSolvable: true for a Math question a graphing calculator makes much faster (graphing to find intersections, zeros, regressions); otherwise false.
The teacher confirms these tags, so make your best judgement.
</sat_tags>

<official_material>
Coursebook never stores official College Board, SAT, PSAT or Bluebook test questions. If the pages are official College Board material (their branding, "© College Board" notices, or Bluebook or Question Bank screenshots), set readable to false and say in "problem" that official questions can't be stored, and that the teacher can attach links to College Board questions to an assignment instead.
</official_material>

If the pages aren't a worksheet with questions (or can't be read), set readable to false and say why in "problem", with an empty list.`;

export const WorksheetDraftSchema = z.object({
  readable: z.boolean(),
  problem: z.string(),
  hasAnswerKey: z.boolean(),
  items: z.array(
    z.object({
      label: z.string(),
      type: z.enum(["multiple_choice", "short_answer", "step_by_step"]),
      prompt: z.string(),
      choices: z.array(z.string()),
      correctChoice: z.number().int(),
      answer: z.string(),
      answerFromWorksheet: z.boolean(),
      explanation: z.string(),
      steps: z.array(z.string()),
      pageRefs: z.array(z.number().int()),
      topic: z.string(),
      satDomain: z.enum(["none", ...DOMAINS.map((d) => d.id)] as [string, ...string[]]),
      satSkill: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      desmosSolvable: z.boolean(),
    }),
  ),
});
export type WorksheetDraft = z.infer<typeof WorksheetDraftSchema>;

export type WorksheetPage = { pageNumber: number; text: string; png: Buffer | null };

export function worksheetUserText(title: string, pages: WorksheetPage[]): string {
  const text = pages.map((p) => `=== Page ${p.pageNumber} ===\n${p.text.trim() || "(no text layer: read the image)"}`).join("\n\n");
  return `Worksheet: "${title}" (${pages.length} ${pages.length === 1 ? "page" : "pages"}; the page images come first, in order).

<extracted_text>
${text}
</extracted_text>

List its questions.`;
}

export type WorksheetItemData = {
  label: string;
  type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP";
  prompt: string;
  choices: string[];
  correctChoice: number | null;
  answer: string;
  explanation: string;
  steps: string[];
  pageRefs: number[];
  topic: string;
  answerSource: "WORKSHEET" | "CLAUDE" | "TEACHER";
  section: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: string | null;
  desmosSolvable: boolean;
  tagsConfirmed: boolean;
};

const tidy = (s: string) => s.replace(/\r/g, "").trim();

/** Claude's suggested SAT tags, cleaned (unknown values dropped); staff confirm them later. */
function tagsFrom(it: { satDomain?: string; satSkill?: string; difficulty?: string; desmosSolvable?: boolean }) {
  const t = cleanTags({ domain: it.satDomain, skill: it.satSkill, difficulty: it.difficulty?.toUpperCase() });
  return { ...t, desmosSolvable: t.section === "MATH" && Boolean(it.desmosSolvable), tagsConfirmed: false };
}

/** Check what Claude listed: drop empty questions, fix broken multiple choice, keep page refs on real pages. */
export function normalizeWorksheet(draft: WorksheetDraft, pageCount: number): WorksheetItemData[] {
  const out: WorksheetItemData[] = [];
  for (const [i, it] of draft.items.entries()) {
    const prompt = tidy(it.prompt);
    if (!prompt) continue;
    const choices = it.choices.map(tidy).filter(Boolean);
    let type: WorksheetItemData["type"] = it.type === "multiple_choice" ? "MULTIPLE_CHOICE" : it.type === "step_by_step" ? "STEP_BY_STEP" : "SHORT_ANSWER";
    let correctChoice: number | null = null;
    if (type === "MULTIPLE_CHOICE") {
      if (choices.length >= 2 && choices.length <= 8 && it.correctChoice >= 0 && it.correctChoice < choices.length) correctChoice = it.correctChoice;
      else type = "SHORT_ANSWER"; // options we can't check: grade it as a written answer instead
    }
    out.push({
      label: tidy(it.label).slice(0, 12) || String(i + 1),
      type,
      prompt,
      choices: type === "MULTIPLE_CHOICE" ? choices : [],
      correctChoice,
      answer: tidy(it.answer) || (correctChoice !== null ? choices[correctChoice] : ""),
      explanation: tidy(it.explanation),
      steps: type === "STEP_BY_STEP" ? it.steps.map(tidy).filter(Boolean) : [],
      pageRefs: [...new Set(it.pageRefs.filter((p) => p >= 1 && p <= pageCount))].sort((a, b) => a - b),
      topic: tidy(it.topic).slice(0, 60) || "General",
      answerSource: it.answerFromWorksheet ? "WORKSHEET" : "CLAUDE",
      ...tagsFrom(it),
    });
    if (out.length >= MAX_WORKSHEET_ITEMS) break;
  }
  return out;
}
