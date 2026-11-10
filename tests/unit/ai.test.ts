import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { cleanInlineCitations, cleanPageRefs, normalizeLessonDraft, normalizeQuestion } from "@/lib/ai/normalize";
import { flashcardsUserMessage, LESSON_SYSTEM_PROMPT, lessonUserMessage, questionsUserMessage } from "@/lib/ai/prompts";
import { assessSource, formatSourcePages, lessonCacheKey, needsRepair, type SourcePage } from "@/lib/ai/source";
import { costUsd } from "@/lib/ai/models";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { AiError, ClaudeWriter } from "@/server/ai/writer";
import { ClaudeBatchRunner } from "@/server/ai/batch";
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
    expect(m).toContain("Flashcards: written separately; return an empty list.");
    expect(flashcardsUserMessage(input)).toContain("8 cards");
    expect(m).toContain("Cite only pages 4–5.");
  });
  it("tells the model to leave out content types the student turned off", () => {
    const m = lessonUserMessage({ ...input, settings: { ...DEFAULT_SETTINGS, contentTypes: ["objectives"] } });
    expect(m).toContain("Practice questions: not wanted");
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
    expect(costUsd("claude-sonnet-5-5", 0, 0, 1_000_000, 0)).toBeCloseTo(0.1);
    expect(costUsd("claude-sonnet-5-5", 0, 0, 0, 1_000_000)).toBeCloseTo(2.5);
    expect(costUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
  });
  it("halves everything sent through the Batch API", () => {
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000, true)).toBeCloseTo((2 + 10 + 0.1 + 2.5) / 2);
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
      // Structured replies arrive as JSON text, like the real API.
      content: r.content ?? (r.parsed_output ? [{ type: "text", text: JSON.stringify(r.parsed_output) }] : []),
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
    };
  };
  // The writer streams every request and waits for finalMessage().
  const client = { messages: { stream: (params: Record<string, unknown>) => ({ finalMessage: () => next(params) }) } } as unknown as Anthropic;
  return { client, requests };
}

const config = {
  model: "claude-sonnet-5-5",
  fallbackModel: "claude-opus-5-5",
  flashcardModel: "claude-haiku-5-5",
  flashcardEffort: "low" as const,
  visionModel: "claude-haiku-5-5",
  effort: "medium" as const,
};
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

  it("writes flashcards on the small model at low effort, from the pages", async () => {
    const { client, requests } = fakeClient([{ stop_reason: "end_turn", parsed_output: { flashcards: sampleDraft(4, 5).flashcards } }]);
    const res = await new ClaudeWriter(client, config).writeFlashcards(input);
    expect(res.value.flashcards).toHaveLength(2);
    const req = requests[0] as { model: string; output_config: { effort: string }; messages: { content: { text: string }[] }[] };
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.output_config.effort).toBe("low");
    expect(req.messages[0].content[0].text).toContain("=== Page 4 ===");
    expect(req.messages[0].content[1].text).toContain("Write only flashcards");
  });

  it("uses the main model for flashcards and page reading in a High quality course", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "end_turn", parsed_output: { flashcards: sampleDraft(4, 5).flashcards } },
      { stop_reason: "end_turn", content: [{ type: "text", text: "$$V = IR$$" }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "$$V = IR$$" }] },
    ]);
    const writer = new ClaudeWriter(client, config);
    await writer.writeFlashcards({ ...input, settings: { ...DEFAULT_SETTINGS, quality: "high" } });
    const high = await writer.repairPage(Buffer.from("png"), "book", "high");
    await writer.repairPage(Buffer.from("png"), "book");
    expect(requests.map((r) => r.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect((requests[0] as { output_config: { effort: string } }).output_config.effort).toBe("medium");
    expect(high.calls[0].model).toBe("claude-sonnet-5-5");
  });

  it("caches the pages for new questions (sent again and again), not for a one-off lesson", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "end_turn", parsed_output: sampleDraft(4, 5) },
      { stop_reason: "end_turn", parsed_output: { questions: sampleDraft(4, 5).questions } },
    ]);
    const writer = new ClaudeWriter(client, config);
    await writer.writeLesson(input);
    await writer.writeQuestions({ ...input, avoid: ["Old one"], focus: "Current" });
    type Req = { messages: { content: { text: string; cache_control?: unknown }[] }[] };
    const [lesson, questions] = requests as unknown as Req[];
    expect(lesson.messages[0].content[0].cache_control).toBeUndefined();
    expect(questions.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    // The cached block is only the pages: the parts that change (skill, questions to avoid) come after it.
    expect(questions.messages[0].content[0].text).toBe(lesson.messages[0].content[0].text);
    expect(questions.messages[0].content[0].text).not.toContain("Old one");
    expect(questions.messages[0].content[1].text).toContain("Old one");
  });

  it("asks for lessons without flashcards (they're a separate request)", async () => {
    const { client, requests } = fakeClient([{ stop_reason: "end_turn", parsed_output: sampleDraft(4, 5) }]);
    await new ClaudeWriter(client, config).writeLesson(input);
    const task = (requests[0] as { messages: { content: { text: string }[] }[] }).messages[0].content[1].text;
    expect(task).toContain("Flashcards: written separately; return an empty list.");
  });

  it("builds batch requests that can be read back, and treats an unreadable reply as retryable", () => {
    const writer = new ClaudeWriter(fakeClient([]).client, config);
    const job = { kind: "lesson" as const, input };
    const params = writer.request(job);
    expect(params).not.toHaveProperty("stream");
    expect(JSON.parse(JSON.stringify(params)).output_config.format.type).toBe("json_schema");
    const msg = (t: string, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text: t }] }) as unknown as Anthropic.Message;
    expect(writer.read<{ objectives: string[] }>("lesson", msg(JSON.stringify(sampleDraft(4, 5))), []).objectives).toHaveLength(2);
    expect(() => writer.read("lesson", msg("not json"), [])).toThrow(expect.objectContaining({ kind: "retryable" }));
    expect(() => writer.read("lesson", msg("", "refusal"), [])).toThrow(expect.objectContaining({ kind: "refused" }));
  });

  it("repairs a page from an image and returns the text", async () => {
    const { client, requests } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "$$V = IR$$" }] }]);
    const res = await new ClaudeWriter(client, config).repairPage(Buffer.from("png"));
    expect(res.value).toBe("$$V = IR$$");
    const content = (requests[0] as { messages: { content: { type: string }[] }[] }).messages[0].content;
    expect(content.map((c) => c.type)).toEqual(["image", "text"]);
  });
});

describe("ClaudeBatchRunner", () => {
  const draft = sampleDraft(4, 5);
  const message = (text: string, stop = "end_turn", model = "claude-sonnet-5-5") => ({
    model,
    stop_reason: stop,
    content: [{ type: "text", text }],
    usage: { input_tokens: 4000, output_tokens: 9000, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 },
  });
  function fakeBatches() {
    const created: { requests: { custom_id: string; params: Record<string, unknown> }[] }[] = [];
    const client = {
      messages: {
        batches: {
          create: async (body: (typeof created)[number]) => (created.push(body), { id: "msgbatch_1", processing_status: "in_progress" }),
          retrieve: async () => ({ id: "msgbatch_1", processing_status: "ended" }),
          results: async () =>
            (async function* () {
              yield { custom_id: "lesson-a", result: { type: "succeeded", message: message(JSON.stringify(draft)) } };
              yield { custom_id: "cards-a", result: { type: "succeeded", message: message(JSON.stringify({ flashcards: draft.flashcards }), "end_turn", "claude-haiku-5-5") } };
              yield { custom_id: "lesson-b", result: { type: "succeeded", message: message("", "refusal") } };
              yield { custom_id: "lesson-c", result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "busy" } } } };
              yield { custom_id: "lesson-d", result: { type: "expired" } };
            })(),
        },
      },
    } as unknown as Anthropic;
    return { client, created };
  }

  it("sends each job's normal request (no streaming) under its custom id", async () => {
    const { client, created } = fakeBatches();
    const writer = new ClaudeWriter(client, config);
    const id = await new ClaudeBatchRunner(client, writer).submit([
      { customId: "lesson-a", job: { kind: "lesson", input } },
      { customId: "cards-a", job: { kind: "flashcards", input } },
    ]);
    expect(id).toBe("msgbatch_1");
    const [lesson, cards] = created[0].requests;
    expect(lesson.custom_id).toBe("lesson-a");
    expect(lesson.params).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 32_000 });
    expect(lesson.params).not.toHaveProperty("stream");
    expect(cards.params).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } });
  });

  it("reads results in any order: usable replies, refusals (billed), and errored or expired requests (not billed)", async () => {
    const { client } = fakeBatches();
    const runner = new ClaudeBatchRunner(client, new ClaudeWriter(client, config));
    expect(await runner.isDone("msgbatch_1")).toBe(true);
    const kinds: Record<string, "lesson" | "flashcards"> = { "lesson-a": "lesson", "cards-a": "flashcards", "lesson-b": "lesson", "lesson-c": "lesson", "lesson-d": "lesson" };
    const out = [];
    for await (const r of runner.results("msgbatch_1", (id) => kinds[id] ?? null)) out.push(r);
    expect(out.map((r) => [r.customId, r.ok])).toEqual([
      ["lesson-a", true],
      ["cards-a", true],
      ["lesson-b", false],
      ["lesson-c", false],
      ["lesson-d", false],
    ]);
    expect(out[0].calls).toEqual([{ value: null, model: "claude-sonnet-5-5", batch: true, usage: { inputTokens: 4000, outputTokens: 9000, cacheReadTokens: 1200, cacheWriteTokens: 0 } }]);
    expect(out[1].ok && (out[1].value as { flashcards: unknown[] }).flashcards).toHaveLength(2);
    expect(out[2]).toMatchObject({ ok: false, error: { kind: "refused" }, calls: [{ batch: true }] });
    expect(out[3]).toMatchObject({ ok: false, error: null, detail: "errored: overloaded_error", calls: [] });
    expect(out[4]).toMatchObject({ ok: false, error: null, detail: "expired", calls: [] });
  });
});

