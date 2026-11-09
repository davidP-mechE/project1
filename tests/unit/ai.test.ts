import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { cleanInlineCitations, cleanPageRefs, normalizeLessonDraft, normalizeQuestion } from "@/lib/ai/normalize";
import { LESSON_SYSTEM_PROMPT, lessonUserMessage, questionsUserMessage } from "@/lib/ai/prompts";
import { assessSource, formatSourcePages, lessonCacheKey, needsRepair, type SourcePage } from "@/lib/ai/source";
import { costUsd } from "@/lib/ai/models";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { AiError, ClaudeWriter } from "@/server/ai/writer";
import { sampleDraft } from "../helpers/fake-claude";

const page = (n: number, text: string, extra: Partial<SourcePage> = {}): SourcePage => ({
  pageNumber: n,
  label: null,
  text,
  textSource: "NATIVE",
  mathScore: 0,
  repairedText: null,
  ...extra,
});
const prose = "Electric charge is a basic property of matter. ".repeat(12);

describe("assessSource", () => {
  it("accepts pages with enough text", () => expect(assessSource([page(4, prose)]).ok).toBe(true));
  it("flags nearly empty lessons", () => {
    const r = assessSource([page(4, "Chapter 3"), page(5, "")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/almost no text/);
  });
  it("flags lessons where most pages have no text", () => {
    const r = assessSource([page(1, prose.repeat(2)), page(2, ""), page(3, "Fig 1"), page(4, "")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/3 of this lesson's 4 pages/);
  });
  it("uses the repaired text of equation-heavy pages", () => {
    const p = page(7, "V I R", { mathScore: 0.4, repairedText: prose });
    expect(needsRepair(p)).toBe(false);
    expect(assessSource([p]).ok).toBe(true);
    expect(needsRepair(page(7, "V I R", { mathScore: 0.4 }))).toBe(true);
  });
});

describe("formatSourcePages", () => {
  it("adds citable page markers, printed labels, and marks empty pages", () => {
    const text = formatSourcePages([page(12, "Hello", { label: "4" }), page(13, "")]);
    expect(text).toBe("=== Page 12 (printed page number 4) ===\nHello\n\n=== Page 13 ===\n[No readable text on this page]");
  });
});

describe("lessonCacheKey", () => {
  const base = {
    promptVersion: "v1",
    model: "claude-sonnet-5-5",
    effort: "medium",
    settings: DEFAULT_SETTINGS,
    courseTitle: "Circuits",
    unitTitle: "1 Charge",
    lessonTitle: "1.1 Basics",
    pages: [page(4, prose)],
  };
  it("is stable for the same inputs", () => expect(lessonCacheKey(base)).toBe(lessonCacheKey({ ...base })));
  it("changes when the source text, settings, prompt or model change", () => {
    const k = lessonCacheKey(base);
    expect(lessonCacheKey({ ...base, pages: [page(4, prose + "!")] })).not.toBe(k);
    expect(lessonCacheKey({ ...base, settings: { ...DEFAULT_SETTINGS, level: "college" } })).not.toBe(k);
    expect(lessonCacheKey({ ...base, promptVersion: "v2" })).not.toBe(k);
    expect(lessonCacheKey({ ...base, model: "claude-opus-5-5" })).not.toBe(k);
  });
  it("ignores settings that don't affect lessons and the order of content types", () => {
    const k = lessonCacheKey(base);
    expect(lessonCacheKey({ ...base, settings: { ...DEFAULT_SETTINGS, includeFrontBackMatter: true } })).toBe(k);
    expect(lessonCacheKey({ ...base, settings: { ...DEFAULT_SETTINGS, contentTypes: [...DEFAULT_SETTINGS.contentTypes].reverse() } })).toBe(k);
  });
});

describe("prompts", () => {
  const input = { courseTitle: "Circuits", unitTitle: "1 Charge", lessonTitle: "1.1 Basics", pageStart: 4, pageEnd: 5, pages: [page(4, "A"), page(5, "B")], settings: DEFAULT_SETTINGS };
  it("keeps the system prompt free of anything that varies (so it caches)", () => {
    expect(LESSON_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(LESSON_SYSTEM_PROMPT).toMatch(/only/i);
    expect(LESSON_SYSTEM_PROMPT.length).toBeGreaterThan(2000); // above the minimum cacheable size
  });
  it("puts the pages first, then the settings", () => {
    const m = lessonUserMessage(input);
    expect(m.indexOf("=== Page 4 ===")).toBeLessThan(m.indexOf("Student level"));
    expect(m).toContain("exactly 6, mixing these types: multiple_choice, short_answer, step_by_step");
    expect(m).toContain("Flashcards: 8.");
    expect(m).toContain("Cite only pages 4–5.");
  });
  it("tells the model to leave out content types the student turned off", () => {
    const m = lessonUserMessage({ ...input, settings: { ...DEFAULT_SETTINGS, contentTypes: ["objectives"] } });
    expect(m).toContain("Practice questions: not wanted");
    expect(m).toContain("Flashcards: not wanted");
    expect(m).toContain("Key terms: not wanted");
  });
  it("asks for new questions that avoid existing ones", () => {
    const m = questionsUserMessage({ ...input, avoid: ["What is current?"] });
    expect(m).toContain("- What is current?");
    expect(m).not.toContain("Explanation style");
  });
});

describe("normalizeLessonDraft", () => {
  const r = { pageStart: 4, pageEnd: 5 };
  it("keeps good content, drops broken questions, and fixes page references", () => {
    const n = normalizeLessonDraft(sampleDraft(4, 5), r, DEFAULT_SETTINGS);
    expect(n.usable).toBe(true);
    if (!n.usable) return;
    expect(n.questions.map((q) => q.type)).toEqual(["MULTIPLE_CHOICE", "SHORT_ANSWER", "STEP_BY_STEP"]);
    expect(n.dropped).toBe(1);
    expect(n.questions[0]).toMatchObject({ correctChoice: 1, answer: "Ampere" }); // filled in from the choice
    expect(n.content.workedExamples[0].pageRefs).toEqual([5]); // 999 removed
    expect(n.flashcards[1].pageRefs).toEqual([4]); // empty → lesson's first page
    expect(n.content.explanation).toContain("(p. 4)");
    expect(n.content.explanation).not.toContain("999");
  });
  it("respects turned-off content types and counts", () => {
    const s = { ...DEFAULT_SETTINGS, contentTypes: ["shortAnswer" as const], questionsPerLesson: 2 };
    const n = normalizeLessonDraft(sampleDraft(4, 5), r, s);
    if (!n.usable) throw new Error("expected usable");
    expect(n.questions.map((q) => q.type)).toEqual(["SHORT_ANSWER"]);
    expect(n.flashcards).toEqual([]);
    expect(n.content.objectives).toEqual([]);
    expect(n.content.keyTerms).toEqual([]);
    expect(n.content.workedExamples).toEqual([]);
  });
  it("flags the lesson when the model says the source isn't usable", () => {
    const n = normalizeLessonDraft(sampleDraft(4, 5, { sourceCheck: { usable: false, problem: "Mostly garbled equations." } }), r, DEFAULT_SETTINGS);
    expect(n).toEqual({ usable: false, reason: "Mostly garbled equations." });
  });
});

describe("question and citation helpers", () => {
  const r = { pageStart: 10, pageEnd: 12 };
  it("cleanPageRefs keeps in-range pages, sorted and unique", () => expect(cleanPageRefs([12, 3, 10, 12, 99], r)).toEqual([10, 12]));
  it("cleanInlineCitations removes only out-of-range citations", () =>
    expect(cleanInlineCitations("A (p. 10). B (pp. 11–12). C (p. 40). D (pp. 9–11).", r)).toBe("A (p. 10). B (pp. 11–12). C. D."));
  it("rejects multiple choice with duplicate choices", () =>
    expect(
      normalizeQuestion({ type: "multiple_choice", prompt: "Q", choices: ["A", "a"], correctChoice: 0, answer: "", explanation: "", steps: [], pageRefs: [], topic: "" }, r),
    ).toBeNull());
  it("rejects step-by-step problems with no steps", () =>
    expect(
      normalizeQuestion({ type: "step_by_step", prompt: "Q", choices: [], correctChoice: -1, answer: "2", explanation: "", steps: [], pageRefs: [], topic: "" }, r),
    ).toBeNull());
});

describe("costUsd", () => {
  it("includes prompt-cache reads and writes", () => {
    expect(costUsd("claude-sonnet-5-5", 0, 0, 1_000_000, 0)).toBeCloseTo(0.2);
    expect(costUsd("claude-sonnet-5-5", 0, 0, 0, 1_000_000)).toBeCloseTo(2.5);
  });
  it("prices unknown models like Opus (never under-count)", () => expect(costUsd("mystery", 1_000_000, 0)).toBe(4));
});

// ─── ClaudeWriter with a fake API client (no network) ────────────────────

type FakeResponse = { stop_reason: string; parsed_output?: unknown; content?: unknown[]; model?: string } | Error;

function fakeClient(responses: FakeResponse[]) {
  const requests: Record<string, unknown>[] = [];
  const next = async (params: Record<string, unknown>) => {
    requests.push(params);
    const r = responses.shift();
    if (!r) throw new Error("no more fake responses");
    if (r instanceof Error) throw r;
    return {
      model: r.model ?? params.model,
      stop_reason: r.stop_reason,
      parsed_output: r.parsed_output ?? null,
      content: r.content ?? [],
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
    };
  };
  // The writer streams every request and waits for finalMessage().
  const client = { messages: { stream: (params: Record<string, unknown>) => ({ finalMessage: () => next(params) }) } } as unknown as Anthropic;
  return { client, requests };
}

const config = { model: "claude-sonnet-5-5", fallbackModel: "claude-opus-5-5", visionModel: "claude-sonnet-5-5", effort: "medium" as const };
const input = { courseTitle: "C", unitTitle: "U", lessonTitle: "L", pageStart: 4, pageEnd: 5, pages: [page(4, prose)], settings: DEFAULT_SETTINGS };

describe("ClaudeWriter", () => {
  it("sends a cached system prompt, structured output format and effort; returns usage", async () => {
    const { client, requests } = fakeClient([{ stop_reason: "end_turn", parsed_output: sampleDraft(4, 5) }]);
    const res = await new ClaudeWriter(client, config).writeLesson(input);
    expect(res.value.objectives).toHaveLength(2);
    expect(res.calls).toEqual([{ value: null, model: "claude-sonnet-5-5", usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } }]);
    const req = requests[0] as { system: { cache_control: unknown }[]; output_config: { effort: string; format: unknown }; model: string };
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.output_config.effort).toBe("medium");
    expect(req.output_config.format).toBeTruthy();
  });

  it("retries a refusal once on the fallback model", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "refusal" },
      { stop_reason: "end_turn", parsed_output: sampleDraft(4, 5), model: "claude-opus-5-5" },
    ]);
    const res = await new ClaudeWriter(client, config).writeLesson(input);
    expect(requests.map((r) => r.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(res.calls.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]); // both are billed
  });

  it("gives up with a friendly message if both models refuse", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal" }, { stop_reason: "refusal" }]);
    await expect(new ClaudeWriter(client, config).writeLesson(input)).rejects.toMatchObject({ kind: "refused" });
  });

  it("reports a lesson that's too long", async () => {
    const { client } = fakeClient([{ stop_reason: "max_tokens" }]);
    const err = (await new ClaudeWriter(client, config).writeLesson(input).catch((e) => e)) as AiError;
    expect(err.kind).toBe("too_long");
    expect(err.userMessage).toMatch(/Split it/);
    expect(err.calls).toHaveLength(1);
  });

  it("classifies API errors: rate limits retry, bad keys don't", async () => {
    const rate = fakeClient([new Anthropic.RateLimitError(429, {}, "slow down", new Headers())]);
    await expect(new ClaudeWriter(rate.client, config).writeLesson(input)).rejects.toMatchObject({ kind: "retryable" });
    const auth = fakeClient([new Anthropic.AuthenticationError(401, {}, "bad key", new Headers())]);
    await expect(new ClaudeWriter(auth.client, config).writeLesson(input)).rejects.toMatchObject({ kind: "config" });
    const overloaded = fakeClient([new Anthropic.InternalServerError(529, {}, "overloaded", new Headers())]);
    await expect(new ClaudeWriter(overloaded.client, config).writeLesson(input)).rejects.toMatchObject({ kind: "retryable" });
  });

  it("repairs a page from an image and returns the text", async () => {
    const { client, requests } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "$$V = IR$$" }] }]);
    const res = await new ClaudeWriter(client, config).repairPage(Buffer.from("png"));
    expect(res.value).toBe("$$V = IR$$");
    const content = (requests[0] as { messages: { content: { type: string }[] }[] }).messages[0].content;
    expect(content.map((c) => c.type)).toEqual(["image", "text"]);
  });
});
