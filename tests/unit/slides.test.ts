import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { decodeXml, paragraphs, parsePptx, PptxError, slideSourceText, slideText } from "@/lib/slides/pptx";
import { classifySlide, groupSizes, slideOutline, titleFromLines, type SlideInfo } from "@/lib/slides/outline";
import { drawable, slidesToPdf } from "@/server/processing/slides-pdf";
import { assessSource, needsRepair, type SourcePage } from "@/lib/ai/source";
import { lessonUserMessage } from "@/lib/ai/prompts";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { validateUploadRequest, titleFromFilename } from "@/lib/upload/limits";
import { rangeText, refPrefix, refsText, sourceNoun } from "@/lib/source-label";
import { linkCitations } from "@/components/lesson/cite-pages";
import { LECTURE, makePptx, TINY_PNG } from "../helpers/slides";

describe("reading PowerPoint files", () => {
  it("decodes XML text", () => {
    expect(decodeXml("A &amp; B &lt;3 &quot;hi&quot; &#x3A9; &#8722;")).toBe('A & B <3 "hi" Ω −');
    expect(paragraphs('<a:p><a:r><a:t>Line</a:t></a:r><a:br/><a:r><a:t>two</a:t></a:r></a:p><a:p/><a:p><a:r><a:t>  </a:t></a:r></a:p>')).toEqual(["Line two"]);
  });

  it("puts the title placeholder first and skips slide numbers and footers", () => {
    const xml = `<p:sp><p:nvPr><p:ph idx="1"/></p:nvPr><a:p><a:t>Body</a:t></a:p></p:sp><p:sp><p:nvPr><p:ph type="ftr"/></p:nvPr><a:p><a:t>Footer</a:t></a:p></p:sp><p:sp><p:nvPr><p:ph type="ctrTitle"/></p:nvPr><a:p><a:t>The title</a:t></a:p></p:sp>`;
    expect(slideText(xml)).toEqual({ title: "The title", body: ["Body"] });
    // No title placeholder: the first short line becomes the title.
    expect(slideText(`<p:sp><a:p><a:t>Short heading</a:t></a:p><a:p><a:t>Detail</a:t></a:p></p:sp>`)).toEqual({ title: "Short heading", body: ["Detail"] });
  });

  it("reads slides in presentation order, with notes, tables and pictures; skips hidden slides", () => {
    const bytes = makePptx([
      { title: "First", body: ["Point A", "Point B"], notes: "Say this out loud." },
      { title: "Hidden one", body: ["secret"], hidden: true },
      { title: "Second & last", table: ["Cell 1", "Cell 2"], image: TINY_PNG },
    ]);
    const slides = parsePptx(bytes);
    expect(slides.map((s) => s.title)).toEqual(["First", "Second & last"]);
    expect(slides[0]).toMatchObject({ number: 1, body: ["Point A", "Point B"], notes: "Say this out loud.", images: [] });
    expect(slides[1]).toMatchObject({ number: 2, body: ["Cell 1", "Cell 2"], notes: "" });
    expect(slides[1].images).toHaveLength(1);
    expect(slides[1].images[0].type).toBe("png");
    expect(slideSourceText(slides[0])).toBe("First\n• Point A\n• Point B\n\nSpeaker notes: Say this out loud.");
  });

  it("explains files it can't read", () => {
    expect(() => parsePptx(new Uint8Array([1, 2, 3]))).toThrow(PptxError);
    expect(() => parsePptx(makePptx([{ title: "Only", hidden: true }]))).toThrow(/hidden/);
  });

  it("lays slides out as a PDF, one page per slide, with notes below", async () => {
    const slides = parsePptx(makePptx(LECTURE));
    const pdf = await PDFDocument.load(await slidesToPdf(slides, "Intro to Circuits"));
    expect(pdf.getPageCount()).toBe(LECTURE.length);
    const [withNotes, plain] = [pdf.getPage(3), pdf.getPage(4)];
    expect(withNotes.getHeight()).toBeGreaterThan(plain.getHeight()); // room for speaker notes
    expect(plain.getWidth()).toBe(960);
  });

  it("swaps characters the built-in PDF fonts can't draw", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(drawable("V = I × R − 2 Ω ≥ 3 → ✓", font)).toBe("V = I × R - 2 Ohm >= 3 -> ?");
  });
});

describe("slide outlines", () => {
  const info = LECTURE.map((s, i): SlideInfo => ({ number: i + 1, title: s.title, text: [s.title, ...(s.body ?? [])].join("\n") }));

  it("recognises cover, agenda, section and closing slides", () => {
    const roles = info.map((s, i) => classifySlide(s, i, info.length));
    expect(roles).toEqual(["cover", "front", "section", "content", "content", "content", "section", "content", "content", "content", "back"]);
  });

  it("makes a unit per section and marks the cover, agenda and closing slides to skip", () => {
    const units = slideOutline(info, "Intro to Circuits");
    expect(units.map((u) => [u.title, u.isFrontBackMatter, u.lessons.map((l) => `${l.title} ${l.pageStart}-${l.pageEnd}`)])).toEqual([
      ["Title and agenda", true, ["Title and agenda 1-2"]],
      ["Charge and current", false, ["Charge and current 3-6"]],
      ["Ohm's law", false, ["Ohm's law 7-10"]],
      ["Closing slides", true, ["Closing slides 11-11"]],
    ]);
  });

  it("without section slides, groups ~6 slides per lesson and 4 lessons per unit", () => {
    const plain: SlideInfo[] = Array.from({ length: 40 }, (_, i) => ({ number: i + 1, title: `Topic ${i + 1}`, text: `Topic ${i + 1}\n${"Some detail about this topic. ".repeat(4)}` }));
    const units = slideOutline(plain, "Deck");
    const lessons = units.flatMap((u) => u.lessons);
    expect(lessons.map((l) => l.pageEnd - l.pageStart + 1).reduce((a, b) => a + b)).toBe(40);
    expect(lessons.every((l) => l.pageEnd - l.pageStart + 1 >= 5 && l.pageEnd - l.pageStart + 1 <= 10)).toBe(true);
    expect(units.map((u) => u.title)).toEqual(["Deck (part 1)", "Deck (part 2)"]);
    expect(lessons[0].title).toBe("Topic 1");
  });

  it("sizes groups evenly", () => {
    expect(groupSizes(0)).toEqual([]);
    expect(groupSizes(4)).toEqual([4]);
    expect(groupSizes(13)).toEqual([7, 6]);
    expect(groupSizes(25)).toEqual([7, 6, 6, 6]);
  });

  it("finds a PDF slide's title from its biggest text", () => {
    expect(
      titleFromLines([
        { text: "Ohm's law", size: 32, x: 48, y: 460 },
        { text: "V = I × R", size: 18, x: 60, y: 400 },
        { text: "7", size: 10, x: 900, y: 20 },
      ]),
    ).toBe("Ohm's law");
    expect(titleFromLines([])).toBe("");
  });

  it("keeps a deck of only title slides as one lesson", () => {
    const units = slideOutline([{ number: 1, title: "Welcome", text: "Welcome" }], "Deck");
    expect(units.flatMap((u) => u.lessons)).toHaveLength(1);
  });
});

describe("writing lessons from slides", () => {
  const slide = (n: number, text: string, extra: Partial<SourcePage> = {}): SourcePage => ({ pageNumber: n, label: null, text, textSource: "NATIVE", mathScore: 0, repairedText: null, imageCount: 0, ...extra });

  it("re-reads picture-heavy slides from their image", () => {
    expect(needsRepair(slide(1, "Diagram of a circuit", { imageCount: 1 }), "slides")).toBe(true);
    expect(needsRepair(slide(1, "x".repeat(500), { imageCount: 1 }), "slides")).toBe(false);
    expect(needsRepair(slide(1, "Section title", { imageCount: 0 }), "slides")).toBe(false);
    expect(needsRepair(slide(1, "", { imageCount: 1 }), "slides")).toBe(true);
    expect(needsRepair(slide(1, "Diagram", { imageCount: 1, repairedText: "done" }), "slides")).toBe(false);
    expect(needsRepair(slide(1, "Diagram", { imageCount: 1 }), "book")).toBe(false);
  });

  it("accepts terse slides that a book lesson would reject", () => {
    const pages = [slide(1, "Resistance\n• Opposes current\n• Measured in ohms"), slide(2, "Ohm's law\n• V = I R\n• Doubling V doubles I\n• For ohmic conductors only")];
    expect(assessSource(pages, "book").ok).toBe(false);
    expect(assessSource(pages, "slides").ok).toBe(true);
    expect(assessSource([slide(1, "Hi")], "slides").ok).toBe(false);
  });

  it("tells Claude these are slides and to cite slide numbers", () => {
    const input = { courseTitle: "Circuits", unitTitle: "Ohm", lessonTitle: "Resistance", pageStart: 7, pageEnd: 10, pages: [slide(7, "Resistance")], settings: DEFAULT_SETTINGS };
    const book = lessonUserMessage(input);
    const deck = lessonUserMessage({ ...input, sourceKind: "slides" });
    expect(book).toContain('Textbook: "Circuits"');
    expect(book).not.toContain("lecture slides");
    expect(deck).toContain('Slide deck: "Circuits"');
    expect(deck).toContain("(slides 7–10)");
    expect(deck).toContain("cite slides like (slide 12)");
  });
});

describe("slide uploads and labels", () => {
  const req = (filename: string, kind?: "book" | "slides", contentType = "") => validateUploadRequest({ filename, size: 1000, contentType, rightsConfirmed: true, kind });

  it("accepts PDF or PowerPoint for slides, PDF only for books", () => {
    expect(req("deck.pptx", "slides").ok).toBe(true);
    expect(req("deck.pdf", "slides").ok).toBe(true);
    expect(req("deck.pptx", "slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation").ok).toBe(true);
    expect(req("deck.key", "slides").ok).toBe(false);
    const book = req("deck.pptx");
    expect(!book.ok && book.error).toContain("Upload it under Slides");
    expect(titleFromFilename("Lecture_03-Circuits.pptx")).toBe("Lecture 03 Circuits");
  });

  it("words references for books and slides", () => {
    expect(rangeText("BOOK", 4, 4)).toBe("p. 4");
    expect(rangeText("BOOK", 4, 6)).toBe("pp. 4–6");
    expect(rangeText("SLIDES", 4, 4)).toBe("slide 4");
    expect(rangeText("SLIDES", 4, 6)).toBe("slides 4–6");
    expect(refsText("SLIDES", [2, 5])).toBe("slides 2, 5");
    expect(refsText(undefined, [])).toBe("");
    expect(refPrefix(null, 1)).toBe("p.");
    expect(sourceNoun("SLIDES")).toBe("slides");
  });

  it("links slide citations in lesson text", () => {
    const parts = linkCitations("Charge repels (slide 4) and flows (slides 5–6).", "book1")!;
    const links = parts.filter((p) => p.type === "element");
    expect(links.map((l) => (l as unknown as { properties: { dataBookPage: string } }).properties.dataBookPage)).toEqual(["4", "5", "6"]);
    expect(parts.map((p) => (p.type === "text" ? p.value : (p as unknown as { children: { value: string }[] }).children[0].value)).join("")).toBe("Charge repels (slide 4) and flows (slides 5–6).");
  });
});
