import { describe, expect, it } from "vitest";
import { chunkPages, estimateTokens } from "@/lib/chunking/chunk";

const para = (n: number, words = 60) => `Paragraph ${n}. ` + Array.from({ length: words }, (_, i) => `word${i}`).join(" ") + ".";

describe("chunkPages", () => {
  it("keeps chunks under the token limit and tracks page ranges", () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({ pageNumber: i + 1, text: [para(i * 3), para(i * 3 + 1), para(i * 3 + 2)].join("\n\n") }));
    const chunks = chunkPages(pages, { maxTokens: 400, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(400);
      expect(c.pageStart).toBeLessThanOrEqual(c.pageEnd);
    }
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks.at(-1)!.pageEnd).toBe(6);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("includes every paragraph at least once", () => {
    const pages = Array.from({ length: 4 }, (_, i) => ({ pageNumber: i + 1, text: `${para(i * 2)}\n\n${para(i * 2 + 1)}` }));
    const all = chunkPages(pages, { maxTokens: 300, overlapTokens: 60 }).map((c) => c.text).join("\n");
    for (let n = 0; n < 8; n++) expect(all).toContain(`Paragraph ${n}.`);
  });

  it("overlaps a short trailing paragraph into the next chunk", () => {
    const pages = [{ pageNumber: 1, text: [para(1, 100), "Short bridge sentence.", para(2, 100)].join("\n\n") }];
    const chunks = chunkPages(pages, { maxTokens: 200, overlapTokens: 30 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const withBridge = chunks.filter((c) => c.text.includes("Short bridge sentence."));
    expect(withBridge.length).toBe(2);
  });

  it("splits a very long paragraph by sentences", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} talks about circuits and charge carefully.`).join(" ");
    const chunks = chunkPages([{ pageNumber: 9, text: long }], { maxTokens: 100, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(100);
      expect(c.pageStart).toBe(9);
    }
  });

  it("returns nothing for empty pages", () => expect(chunkPages([{ pageNumber: 1, text: "  " }])).toEqual([]));
  it("estimates ~4 characters per token", () => expect(estimateTokens("abcd".repeat(10))).toBe(10));
});
