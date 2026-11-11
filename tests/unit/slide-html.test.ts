import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sanitizeSlideHtml, SLIDE_HTML_MAX } from "@/lib/slides/sanitize";
import { SlideCourseSchema, slidesToMarkdown } from "@/server/hub-import";

describe("cleaning imported slide HTML", () => {
  it("keeps layout, text, tables and drawings", () => {
    const html = '<section style="background:#0f1b33;padding:80px"><div style="display:flex;gap:24px"><h2 style="color:#fff">Title</h2><p>x <b>y</b></p></div><table><tr><td>1</td></tr></table><svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="#000"/></svg></section>';
    const out = sanitizeSlideHtml(html);
    expect(out).toContain('style="background:#0f1b33;padding:80px"');
    expect(out).toContain("<h2");
    expect(out).toContain("<td>1</td>");
    expect(out).toContain('<line x1="0" y1="0" x2="10" y2="10" stroke="#000"');
  });

  it("removes scripts, event handlers, links, images and frames", () => {
    const out = sanitizeSlideHtml(
      '<section><script>alert(1)</script><p onclick="alert(1)" onmouseover="x()">t</p><a href="javascript:alert(1)">l</a><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe><svg><script>x</script><a href="https://evil.example"><circle r="1" onload="x()"/></a></svg><style>body{}</style></section>',
    );
    expect(out).not.toMatch(/script|onclick|onmouseover|onerror|onload|href|<img|<iframe|<a\b|<style|alert/i);
    expect(out).toContain(">t</p>");
  });

  it("drops styles that load anything or run code", () => {
    for (const bad of ["background:url(https://evil.example/x.png)", "background-image: URL ('x')", "behavior:url(x.htc)", "width:expression(alert(1))", "@import 'x'", "-moz-binding:url(x)"]) {
      expect(sanitizeSlideHtml(`<div style="${bad}">t</div>`)).toBe("<div>t</div>");
    }
    expect(sanitizeSlideHtml('<div style="color:red">t</div>')).toBe('<div style="color:red">t</div>');
  });

  it("caps the length", () => {
    expect(sanitizeSlideHtml(`<p>${"a".repeat(SLIDE_HTML_MAX * 2)}</p>`).length).toBeLessThanOrEqual(SLIDE_HTML_MAX);
  });
});

describe("the text version of slides", () => {
  it("numbers slides and escapes Markdown and math", () => {
    const md = slidesToMarkdown([{ text: "Price is $5 * 2\n\n# not a heading\n_x_" }, { text: "" }]);
    expect(md).toContain("### Slide 1\n\nPrice is \\$5 \\* 2  \n\\# not a heading  \n\\_x\\_");
    expect(md).toContain("### Slide 2\n\n_(no text)_");
  });
});

describe("the SAT course files in content/hub", () => {
  for (const [key, title, subject, lessons] of [["sat-math", "SAT Math", "math", 14], ["sat-ebrw", "SAT EBRW", "ela", 16]] as const) {
    it(`${title} is valid, numbered page by page, and free of tutor notes and template slides`, () => {
      const data = SlideCourseSchema.parse(JSON.parse(readFileSync(`content/hub/${key}.json`, "utf8")));
      expect(data).toMatchObject({ key, title, subject });
      const all = data.units.flatMap((u) => u.lessons);
      expect(all).toHaveLength(lessons);
      let page = 1;
      for (const l of all) {
        expect(l.pageStart).toBe(page);
        page += l.slides.length;
        expect(l.pageEnd).toBe(page - 1);
        for (const s of l.slides) {
          expect(s.html).not.toMatch(/<aside|<script|data-transition/i);
          expect(s.id).not.toMatch(/-you$|^bank$|errorlog|^materials$/);
        }
      }
      expect(page - 1).toBe(data.pageCount);
      expect(readFileSync(`content/hub/${key}.pdf`).subarray(0, 5).toString()).toBe("%PDF-");
    });
  }
});
