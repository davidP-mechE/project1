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
