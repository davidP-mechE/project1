/**
 * Real Claude API smoke test: writes ONE lesson from the test textbook,
 * re-reads one equation-heavy page from its image, and grades two written
 * answers (one right in other words, one wrong), then prints the results and
 * exactly what it cost. Costs roughly $0.05–0.10.
 *
 *   npm run smoke:claude
 *
 * Needs ANTHROPIC_API_KEY in .env. Doesn't touch the database.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "../src/lib/ai/models";
import { normalizeFlashcards, normalizeLessonDraft } from "../src/lib/ai/normalize";
import { DEFAULT_SETTINGS } from "../src/lib/course/settings";
import { mathScore } from "../src/lib/pdf/math-score";
import type { SourcePage } from "../src/lib/ai/source";
import { PdfReader } from "../src/server/processing/pdf-reader";
import { AiError, ClaudeWriter, type Call } from "../src/server/ai/writer";
import { ClaudeGrader } from "../src/server/ai/grader";
import { normalizeGrade } from "../src/lib/grading/grade";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY in .env first.");
    process.exit(1);
  }
  const model = process.env.CLAUDE_MODEL_GENERATION ?? "claude-sonnet-5-5";
  const writer = new ClaudeWriter(new Anthropic(), {
    model,
    fallbackModel: process.env.CLAUDE_MODEL_FALLBACK ?? "claude-opus-5-5",
    flashcardModel: process.env.CLAUDE_MODEL_FLASHCARDS ?? "claude-haiku-5-5",
    flashcardEffort: (process.env.CLAUDE_EFFORT_FLASHCARDS as "low") ?? "low",
    visionModel: process.env.CLAUDE_MODEL_VISION ?? "claude-haiku-5-5",
    effort: (process.env.CLAUDE_EFFORT_GENERATION as "medium") ?? "medium",
  });

  const reader = await PdfReader.open(new Uint8Array(readFileSync("tests/fixtures/outlined.pdf")));
  const pageAt = async (n: number): Promise<SourcePage> => {
    const p = await reader.readPage(n);
    return { pageNumber: n, label: null, text: p.text, textSource: "NATIVE", mathScore: mathScore(p.text), repairedText: null };
  };
  const calls: Call<unknown>[] = [];
  const report = (label: string, cs: Call<unknown>[]) => {
    for (const c of cs) {
      const u = c.usage;
      const cost = costUsd(c.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens);
      console.log(`  ${label}: ${c.model} | in ${u.inputTokens} (cache read ${u.cacheReadTokens}, write ${u.cacheWriteTokens}) | out ${u.outputTokens} | $${cost.toFixed(4)}`);
    }
    calls.push(...cs);
  };

  try {
    // 1) A lesson from pages 4–5 ("1.1 Charge" + "1.2 Current").
    console.log("Writing a lesson from pages 4–5…");
    const t0 = Date.now();
    const lesson = await writer.writeLesson({
      courseTitle: "Basic Circuits",
      unitTitle: "1 Electric Charge and Current",
      lessonTitle: "1.1 Charge",
      pageStart: 4,
      pageEnd: 5,
      pages: [await pageAt(4), await pageAt(5)],
      settings: DEFAULT_SETTINGS,
    });
    report("lesson", lesson.calls);
    const n = normalizeLessonDraft(lesson.value, { pageStart: 4, pageEnd: 5 }, DEFAULT_SETTINGS);
    console.log(`  took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!n.usable) {
      console.log(`  FLAGGED: ${n.reason}`);
    } else {
      console.log(`  objectives: ${n.content.objectives.length}, key terms: ${n.content.keyTerms.length}, questions: ${n.questions.length} (${n.dropped} dropped), flashcards: ${n.flashcards.length}`);
      console.log("\n--- explanation (first 900 characters) ---\n" + n.content.explanation.slice(0, 900) + "\n---");
      console.log("first question:", JSON.stringify(n.questions[0], null, 2));
    }

    // 1b) Its flashcards, written by the small model in their own request.
    console.log("\nWriting the lesson's flashcards (small model)…");
    const lessonInput = {
      courseTitle: "Basic Circuits",
      unitTitle: "1 Electric Charge and Current",
      lessonTitle: "1.1 Charge",
      pageStart: 4,
      pageEnd: 5,
      pages: [await pageAt(4), await pageAt(5)],
      settings: DEFAULT_SETTINGS,
    };
    const cards = await writer.writeFlashcards(lessonInput);
    report("flashcards", cards.calls);
    for (const c of normalizeFlashcards(cards.value.flashcards, { pageStart: 4, pageEnd: 5 }, DEFAULT_SETTINGS)) {
      console.log(`  - ${c.front} → ${c.back} (p. ${c.pageRefs.join(", ")})`);
    }

    // 2) Re-read the equation page (7) from its image.
    console.log("\nRe-reading page 7 (equations) from an image…");
    const png = (await reader.render(7, { width: 1600 })).toBuffer("image/png");
    const repaired = await writer.repairPage(png);
    report("page repair", repaired.calls);
    console.log("--- page 7 as LaTeX (first 600 characters) ---\n" + repaired.value.slice(0, 600) + "\n---");

    // 3) Grade two written answers to a short-answer question about page 5.
    const grader = new ClaudeGrader(new Anthropic(), {
      model: process.env.CLAUDE_MODEL_GRADING ?? "claude-opus-5-5",
      effort: (process.env.CLAUDE_EFFORT_GRADING as "low") ?? "low",
    });
    const question = {
      type: "SHORT_ANSWER" as const,
      prompt: "What is electric current?",
      answer: "The rate at which electric charge flows through a conductor.",
      explanation: "A good answer says current is a rate of flow of charge.",
      steps: [],
      pages: [await pageAt(5)],
    };
    for (const [label, response] of [
      ["right, own words", "How much charge passes through the wire per second"],
      ["wrong", "The force that pushes electrons, measured in volts"],
    ] as const) {
      console.log(`\nGrading a ${label} answer: "${response}"`);
      const t1 = Date.now();
      const g = await grader.grade({ ...question, response });
      report("grading", g.calls);
      const r = normalizeGrade(g.value);
      console.log(`  ${r.verdict} (score ${r.score}) in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${r.feedback}`);
    }
  } catch (err) {
    if (err instanceof AiError) {
      report("failed call", err.calls);
      console.error(`\nFAILED (${err.kind}): ${err.userMessage}\n${err.message}`);
      process.exitCode = 1;
    } else throw err;
  } finally {
    await reader.close();
  }
  const total = calls.reduce((s, c) => s + costUsd(c.model, c.usage.inputTokens, c.usage.outputTokens, c.usage.cacheReadTokens, c.usage.cacheWriteTokens), 0);
  console.log(`\nTotal cost: $${total.toFixed(4)}`);
}

main();
