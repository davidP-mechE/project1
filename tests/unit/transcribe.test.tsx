import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, underlineMarks } from "@/components/lesson/markdown";
import { checkTranscript, latexProblems, mathSegments, showsText, textRow, type Transcript } from "@/lib/bank/transcribe";
import { imageTokens, webpSize } from "@/server/qbank-transcribe";
import type { QbankRow } from "@/lib/bank/qbank";

/** Turning Question Bank images into text: the checks that decide text vs. review, and the display pieces. */

const t = (over: Partial<Transcript> = {}): Transcript => ({
  legible: true,
  stem: "If $3x + 5 = 20$, what is the value of $x$?",
  choices: [],
  figure: { needed: false, box: null, description: "" },
  explanation: "Subtract 5: $3x = 15$, so $x = 5$.",
  answer: "5",
  problems: "",
  ...over,
});
const spr = { type: "spr" as const, correct_answer: "5", section: "math" };
const key = { type: "grid_in" as const, answer: "5" };

describe("checking a transcription", () => {
  it("passes when Claude's answer matches the key, the math renders and the shape is right", () => {
    expect(checkTranscript(t(), spr, key)).toEqual({ ok: true, reasons: [] });
    // Any accepted form of the key counts.
    expect(checkTranscript(t({ answer: "3/17" }), { ...spr, correct_answer: ".1764, .1765, 3/17" }, { type: "grid_in", answer: ".1764|.1765|3/17" }).ok).toBe(true);
  });

  it("sends anything doubtful to review, saying why", () => {
    expect(checkTranscript(t({ answer: "6" }), spr, key).reasons).toEqual(["Claude's answer (6) doesn't match the key (5)."]);
    expect(checkTranscript(t({ stem: "Solve $\\frac{3}{x$." }), spr, key).reasons[0]).toMatch(/Math that doesn't render/);
    expect(checkTranscript(t({ legible: false, problems: "The bottom is cut off." }), spr, key).reasons[0]).toBe("Not fully legible: The bottom is cut off.");
    expect(checkTranscript(t({ choices: ["1", "2", "3"], answer: "B" }), { type: "mcq", correct_answer: "B", section: "math" }, { type: "mcq", answer: "B" }).reasons).toEqual(["Expected four choices, got 3."]);
    expect(checkTranscript(t({ figure: { needed: true, box: null, description: "A graph" } }), spr, key).reasons).toEqual(["A figure is needed but its position wasn't given."]);
    expect(checkTranscript(t({ explanation: "" }), spr, key).reasons).toEqual(["The explanation is empty."]);
  });

  it("reads math segments but not escaped dollar amounts", () => {
    expect(mathSegments("Pay \\$35, then $x^2$ and $$y = 2$$")).toEqual(["x^2", "y = 2"]);
    expect(latexProblems("$x^2$ and $\\frac{1}{2}$")).toEqual([]);
    expect(latexProblems("$\\frac{1}{$")).toHaveLength(1);
  });
});

describe("using a transcription", () => {
  const row: QbankRow = {
    externalId: "CB-ac472881", source: "college_board", sourceDetail: null, audience: "in_house", section: "math", skillId: "s", difficulty: 3, type: "grid_in",
    stem: "", choices: [], answer: "5", explanation: "", imageUrl: "/api/bank/qbank/ac472881_q.webp", imageIsQuestion: true, imageAlt: "hint", rationaleImageUrl: "/api/bank/qbank/ac472881_r.webp", searchText: "hint", lesson: null, status: "published",
  };
  it("the text version replaces the images; a needed figure is shown with the text", () => {
    expect(textRow(row, t(), null, "")).toMatchObject({ stem: t().stem, imageUrl: null, imageIsQuestion: false, imageAlt: null, explanation: t().explanation, rationaleImageUrl: null, answer: "5" });
    const withFig = textRow(row, t({ figure: { needed: true, box: { x0: 0, y0: 0.5, x1: 1, y1: 1 }, description: "A line graph" } }), "/api/bank/qbank/ac472881_fig.webp", "");
    expect(withFig).toMatchObject({ imageUrl: "/api/bank/qbank/ac472881_fig.webp", imageIsQuestion: false, imageAlt: "A line graph" });
    expect(textRow(row, t({ explanation: "" }), null, "")).toMatchObject({ rationaleImageUrl: row.rationaleImageUrl });
    expect(["auto_text", "approved_text"].every(showsText)).toBe(true);
    expect(["review", "kept_image", "none"].some(showsText)).toBe(false);
  });

  it("underlines <u>…</u> without passing any HTML through", () => {
    expect(underlineMarks("the <u>a singular</u> change")).toBe("the [a singular](#__u) change");
    const html = renderToStaticMarkup(<Markdown>{"As used in the text, what does <u>a singular</u> mean? <script>x</script>"}</Markdown>);
    expect(html).toContain("<u>a singular</u>");
    expect(html).not.toContain("<script>");
  });
});

describe("cost estimate helpers", () => {
  it("reads WebP sizes and counts image tokens", () => {
    const vp8x = Buffer.alloc(30);
    vp8x.write("RIFF", 0);
    vp8x.write("WEBP", 8);
    vp8x.write("VP8X", 12);
    vp8x.writeUIntLE(796, 24, 3);
    vp8x.writeUIntLE(66, 27, 3);
    expect(webpSize(vp8x)).toEqual({ w: 797, h: 67 });
    expect(webpSize(Buffer.from("not an image at all, really not"))).toBeNull();
    expect(imageTokens(797, 67)).toBe(Math.ceil((797 * 67) / 750));
    expect(imageTokens(4000, 4000)).toBeLessThanOrEqual(1600);
  });
});
