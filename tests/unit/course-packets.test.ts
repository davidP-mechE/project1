import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBankAnswer, gridInCorrect } from "@/lib/bank/answers";
import { normalizeAcceptedList, parseQbankItem, qbankImageUrl } from "@/lib/bank/qbank";
import { embedUrl, parseYouTubeUrl, videoFromUrl } from "@/lib/studio/blocks";
import { escapeCurrency, packetSets, parsePacket } from "@/lib/studio/packet";

/** The SAT course packets and the in-house Question Bank file: parsing, display data and grading. */

const resolve = (name: string, section: "math" | "rw") => `${section}:${name.toLowerCase()}`;

describe("grid-in answers listed with commas (Question Bank keys)", () => {
  const spr = (answer: string, given: string) => checkBankAnswer({ type: "grid_in", answer: normalizeAcceptedList(answer), distractorNotes: {} }, given).correct;

  it("accepts every listed form and numerically equivalent ones", () => {
    const key = ".1764, .1765, 3/17";
    for (const g of [".1764", ".1765", "0.1764", "0.1765", "3/17", "6/34", " 3/17 "]) expect(spr(key, g)).toBe(true);
    for (const g of [".17", "0.18", "17/3", "", "abc"]) expect(spr(key, g)).toBe(false);
  });

  it("accepts fractions and decimals of the same value, with or without a leading zero", () => {
    for (const g of ["0.25", ".25", "1/4", "2/8", "0.250"]) expect(spr("0.25, 1/4", g)).toBe(true);
    for (const g of [".2", "1/5", "0.26"]) expect(spr("0.25, 1/4", g)).toBe(false);
    expect(spr("8.6, 43/5", "8.60")).toBe(true);
    expect(spr("-28", "−28")).toBe(true);
  });

  it("reads 'and' in a list, and never splits 1,000", () => {
    expect(normalizeAcceptedList("7, 8, and 13")).toBe("7|8|13");
    expect(normalizeAcceptedList("1/6, .1666, .1667, 0.166, and 0.167")).toBe("1/6|.1666|.1667|0.166|0.167");
    expect(spr("7, 8, and 13", "13")).toBe(true);
    expect(spr("7, 8, and 13", "9")).toBe(false);
    expect(gridInCorrect("1000", "1,000")).toBe(true);
    // Stored keys may still hold commas: the grader splits them too.
    expect(gridInCorrect("3/17", ".1764, .1765, 3/17")).toBe(true);
  });

  it("grades multiple choice by letter", () => {
    expect(checkBankAnswer({ type: "mcq", answer: "B", distractorNotes: {} }, "b").correct).toBe(true);
    expect(checkBankAnswer({ type: "mcq", answer: "B", distractorNotes: {} }, "C").correct).toBe(false);
  });
});

describe("Question Bank items", () => {
  const math = {
    question_id: "ac472881", source: "college_board", section: "math", domain: "Algebra", skill: "Linear equations in one variable", difficulty: "Hard", type: "spr",
    correct_answer: ".1764, .1765, 3/17", question_image: "ac472881_q.webp", rationale_image: "ac472881_r.webp", text_hint: "If the equation has infinitely many solutions, what is the value of ?",
    rationale_text_hint: "The correct answer is .", home_lesson: "M-1.1", lesson_ids: ["M-0.1"], pdf_pages: [1, 1], has_figure: true, some_new_field: { x: 1 },
  };
  const rw = { question_id: "84b5125b", section: "reading-writing", skill: "Words in Context", difficulty: "Easy", type: "mcq", correct_answer: "b", stem_text: "Baskets are ______ sweetgrass.\n\nWhich choice completes the text?", choices: { A: "indicated by", B: "handmade from", C: "represented by", D: "collected with" }, rationale_text: "Choice B is the best answer.", home_lesson: "RW-2.1" };

  it("a math item: the image is the question, the hints are for search and alt text only", () => {
    const p = parseQbankItem(math, resolve, "export");
    expect(p.errors).toEqual([]);
    expect(p.row).toMatchObject({
      externalId: "CB-ac472881", source: "college_board", audience: "in_house", section: "math", skillId: "math:linear equations in one variable", difficulty: 3, type: "grid_in",
      stem: "", choices: [], answer: ".1764|.1765|3/17", explanation: "", imageUrl: qbankImageUrl("ac472881_q.webp"), imageIsQuestion: true, rationaleImageUrl: "/api/bank/qbank/ac472881_r.webp", lesson: "M-1.1", status: "published",
    });
    expect(p.row!.imageAlt).toContain("infinitely many solutions");
    expect(p.row!.searchText).toContain("The correct answer is");
    expect(p.images).toEqual(["ac472881_q.webp", "ac472881_r.webp"]);
  });

  it("a reading-writing item: passage text with choices; with an image, the image plus A–D, alt text with the choices", () => {
    const text = parseQbankItem(rw, resolve);
    expect(text.row).toMatchObject({ section: "rw", type: "mcq", answer: "B", stem: rw.stem_text, choices: ["indicated by", "handmade from", "represented by", "collected with"], explanation: "Choice B is the best answer.", imageIsQuestion: false, rationaleImageUrl: null });
    const img = parseQbankItem({ ...rw, question_id: "359902ae", question_image: "359902ae_q.webp" }, resolve);
    expect(img.row).toMatchObject({ imageIsQuestion: true, stem: "", choices: [] });
    expect(img.row!.imageAlt).toContain("B. handmade from");
  });

  it("splits Command of Evidence by its home lesson, strips NUL bytes, and reports bad rows", () => {
    expect(parseQbankItem({ ...rw, skill: "Command of Evidence", home_lesson: "RW-1.3" }, resolve).row!.skillId).toBe("rw:command of evidence: quantitative");
    expect(parseQbankItem({ ...rw, skill: "Command of Evidence", home_lesson: "RW-1.2" }, resolve).row!.skillId).toBe("rw:command of evidence: textual");
    expect(parseQbankItem({ ...rw, stem_text: "A\u0000B text" }, resolve).row!.stem).toBe("AB text");
    expect(parseQbankItem({ ...rw, question_id: "nope" }, resolve).errors[0]).toMatch(/8-character/);
    expect(parseQbankItem({ ...rw, correct_answer: "E" }, resolve).errors[0]).toMatch(/isn't A–D/);
    expect(parseQbankItem({ ...rw, skill: "Juggling" }, () => null).errors[0]).toMatch(/Unknown skill/);
    expect(parseQbankItem({ ...math, question_image: "../../etc/passwd" }, resolve).errors.join(" ")).toMatch(/valid file name/);
  });
});

describe("YouTube links", () => {
  it("accepts watch, youtu.be, shorts, embed and playlist links", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=8PrSFbEJXvY")).toEqual({ provider: "youtube", videoId: "8PrSFbEJXvY" });
    expect(parseYouTubeUrl("https://youtu.be/8PrSFbEJXvY?t=30")).toEqual({ provider: "youtube", videoId: "8PrSFbEJXvY" });
    expect(parseYouTubeUrl("youtube.com/shorts/-v0dUN21keI")).toEqual({ provider: "youtube", videoId: "-v0dUN21keI" });
    expect(parseYouTubeUrl("https://m.youtube.com/watch?v=8PrSFbEJXvY&list=PLREMg1hjwo3yeLHVxUN7ccSKlNzBUmIrY")).toEqual({ provider: "youtube", videoId: "8PrSFbEJXvY" });
    expect(parseYouTubeUrl("https://www.youtube.com/playlist?list=PLREMg1hjwo3yeLHVxUN7ccSKlNzBUmIrY")).toEqual({ provider: "youtube_playlist", playlistId: "PLREMg1hjwo3yeLHVxUN7ccSKlNzBUmIrY" });
    expect(parseYouTubeUrl("https://www.youtube-nocookie.com/embed/8PrSFbEJXvY")).toEqual({ provider: "youtube", videoId: "8PrSFbEJXvY" });
    for (const bad of ["https://vimeo.com/123", "https://www.youtube.com/watch?v=short", "https://evil.com/watch?v=8PrSFbEJXvY", "not a link"]) expect(parseYouTubeUrl(bad)).toBeNull();
  });

  it("embeds in privacy-enhanced mode, playlists via videoseries", () => {
    expect(embedUrl({ provider: "youtube", videoId: "8PrSFbEJXvY" })).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/8PrSFbEJXvY\?/);
    expect(embedUrl({ provider: "youtube_playlist", playlistId: "PLREMg1hjwo3yeLHVxUN7ccSKlNzBUmIrY" })).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/videoseries\?list=PLREMg1hjwo3yeLHVxUN7ccSKlNzBUmIrY/);
    expect(videoFromUrl("https://youtu.be/8PrSFbEJXvY", "  ")).toMatchObject({ title: "Video", reviewStatus: "unreviewed", url: "https://www.youtube.com/watch?v=8PrSFbEJXvY" });
  });
});

describe("course packets", () => {
  const packet = (blocks: unknown[], extra: object = {}) => ({
    format: "coursebook-course-packet",
    format_version: 1,
    course: { slug: "sat-test", title: "Test", section: "math", status: "draft", visibility: "owner_only", unknown_course_field: true, units: [{ id: "T-U1", number: 1, title: "Algebra", summary: "Lines.", lessons: [{ id: "T-1.1", number: "1.1", title: "Lines", estimated_minutes: 40, objectives: ["Find slope."], skills: ["Linear functions"], blueprints: ["A1"], blocks }], review_sets: [{ type: "question_set", set_id: "T-U1-review-1", title: "Review", question_ids: ["aaaaaaaa"], status: "ready", visibility: "in_house" }] }], ...extra },
  });

  it("reads every block type, skips unknown types and fields with a warning, and adds a review lesson", () => {
    const p = parsePacket(
      packet([
        { type: "markdown", content: "A **$35** fee and $2x+3$." },
        { type: "video", provider: "youtube", video_id: "8PrSFbEJXvY", url: "https://www.youtube.com/watch?v=8PrSFbEJXvY", title: "V", why_watch: "Why", review_status: "unreviewed", future_field: 1 },
        { type: "desmos", title: "Graph", use_when: "Always", steps: ["Type it"], expressions: [{ id: "e1", latex: "y=2x+3" }], check: "x=1", watch_out: "Costs $5" },
        { type: "callout", variant: "trap", title: "Careful", content: "Sign errors." },
        { type: "checkpoint", title: "Quick check", instructions: "Try it", items: [{ id: "c1", prompt: "A $40 plan?", answer: "Yes", explanation: "Because." }] },
        { type: "hologram", content: "?" },
        { type: "question_set", set_id: "T-1.1", title: "Set", question_ids: ["ac472881", "84b5125b"], status: "ready", visibility: "in_house", difficulty_counts: { Easy: 1 } },
      ]),
    );
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual(['T-1.1: unknown block type "hologram" (skipped).']);
    const c = p.course!;
    expect(c.units[0]).toMatchObject({ key: "T-U1", title: "Unit 1: Algebra", summary: "Lines." });
    expect(c.units[0].lessons.map((l) => l.key)).toEqual(["T-1.1", "T-U1-review"]);
    const l = c.units[0].lessons[0];
    expect(l).toMatchObject({ number: "1.1", estimatedMinutes: 40, objectives: ["Find slope."], blueprints: ["A1"] });
    expect(l.blocks.map((b) => b.kind)).toEqual(["markdown", "video", "desmos", "callout", "checkpoint", "question_set"]);
    expect(l.blocks[0]).toMatchObject({ data: { text: "A **\\$35** fee and $2x+3$." } });
    expect(l.blocks[1]).toMatchObject({ key: "video:8PrSFbEJXvY", data: { videoId: "8PrSFbEJXvY", whyWatch: "Why", reviewStatus: "unreviewed" } });
    expect(l.blocks[2]).toMatchObject({ data: { useWhen: "Always", expressions: [{ id: "e1", latex: "y=2x+3" }], watchOut: "Costs \\$5" } });
    expect((l.blocks[4] as unknown as { data: { items: { prompt: string }[] } }).data.items[0].prompt).toBe("A \\$40 plan?");
    expect(packetSets(c).map((s) => s.set_id)).toEqual(["T-1.1", "T-U1-review-1"]);
  });

  it("refuses other formats and versions", () => {
    expect(parsePacket({ format: "something-else" }).errors[0]).toMatch(/Not a course packet/);
    expect(parsePacket({ ...packet([]), format_version: 2 }).errors[0]).toMatch(/version 2/);
  });

  it("escapes dollar amounts but not math", () => {
    expect(escapeCurrency("A gym charges a $35 sign-up fee plus $22 per month.")).toBe("A gym charges a \\$35 sign-up fee plus \\$22 per month.");
    expect(escapeCurrency("= **$72**, then $24,000 and $2.25.")).toBe("= **\\$72**, then \\$24,000 and \\$2.25.");
    expect(escapeCurrency("like %, $ or commas")).toBe("like %, \\$ or commas");
    for (const math of ["Solve $2x+3=7$ now", "$x^2$", "$3$", "already \\$5"]) expect(escapeCurrency(math)).toBe(math);
  });

  // The real files: every question id a course uses is in the bank (skipped if the bank file isn't here: it isn't committed).
  const dir = "data/course-packets";
  const bankFile = `${dir}/coursebook_sat_question_bank.json`;
  it.skipIf(!existsSync(bankFile))("every question_id referenced by the two courses resolves to a bank item", () => {
    const bank = new Set((JSON.parse(readFileSync(bankFile, "utf8")).items as { question_id: string }[]).map((i) => i.question_id));
    let referenced = 0;
    for (const f of ["coursebook_sat_math_course.json", "coursebook_sat_rw_course.json"]) {
      const p = parsePacket(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
      expect(p.errors).toEqual([]);
      expect(p.warnings).toEqual([]);
      const ids = packetSets(p.course!).flatMap((s) => s.question_ids);
      referenced += ids.length;
      expect(ids.filter((id) => !bank.has(id))).toEqual([]);
    }
    expect(referenced).toBe(4125);
  });
});
