import { describe, expect, it } from "vitest";
import { normalizeDisplayMath } from "@/components/lesson/markdown";

describe("normalizeDisplayMath", () => {
  it("turns a one-line $$…$$ into a displayed equation block", () =>
    expect(normalizeDisplayMath("Ohm's law:\n\n$$V = IR$$\n\nNext.")).toBe("Ohm's law:\n\n$$\nV = IR\n$$\n\nNext."));
  it("leaves inline math and existing blocks alone", () => {
    expect(normalizeDisplayMath("Here $x$ and $$y$$ inline in a sentence.")).toBe("Here $x$ and $$y$$ inline in a sentence.");
    expect(normalizeDisplayMath("$$\nE = mc^2\n$$")).toBe("$$\nE = mc^2\n$$");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/lesson/markdown";

describe("<Markdown>", () => {
  const html = renderToStaticMarkup(
    <Markdown>{"Law:\n\n$$V = IR$$\n\nInline $x^2$.\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) <img src=x onerror=alert(1)>"}</Markdown>,
  );
  it("renders displayed and inline math with KaTeX", () => {
    expect(html).toContain('class="katex-display"');
    expect((html.match(/class="katex"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("never renders raw HTML or javascript: links from lesson text (XSS safety)", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });
});

import { linkCitations } from "@/components/lesson/cite-pages";

describe("page citations", () => {
  it("links each page number in (p. N) / (pp. N–M, K)", () => {
    const parts = linkCitations("Charge is conserved (p. 4). See also (pp. 5–6, 9).", "book1")!;
    const links = parts.filter((p) => p.type === "element");
    expect(links.map((l) => (l as unknown as { properties: { dataBookPage: string } }).properties.dataBookPage)).toEqual(["4", "5", "6", "9"]);
    const text = parts.map((p) => (p.type === "text" ? p.value : (p as unknown as { children: { value: string }[] }).children[0].value)).join("");
    expect(text).toBe("Charge is conserved (p. 4). See also (pp. 5–6, 9).");
  });
  it("leaves text without citations alone", () => expect(linkCitations("Page 4 of the notes (pages) p. 5", "b")).toBeNull());

  const html = renderToStaticMarkup(<Markdown bookId="book1">{"Ohm's law $V = IR$ (p. 7).\n\n`(p. 8)` in code"}</Markdown>);
  it("renders citations as links to the book that the study page can open", () => {
    expect(html).toContain('href="/api/books/book1/file#page=7"');
    expect(html).toContain('data-book-page="7"');
    expect(html).not.toContain("page=8"); // not inside code
    expect(html).toContain('class="katex"'); // math still renders
  });
  it("adds no links without a bookId (e.g. the editor preview)", () =>
    expect(renderToStaticMarkup(<Markdown>{"x (p. 7)"}</Markdown>)).not.toContain("data-book-page"));
});
