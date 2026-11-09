import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage } from "pdf-lib";
import type { PptxSlide } from "@/lib/slides/pptx";

/**
 * Lays out a PowerPoint deck as a simple PDF (one page per slide: title,
 * bullet points, the main picture, and speaker notes underneath), so the
 * slide viewer can show it next to the lessons. It's a readable stand-in, not
 * a pixel-perfect copy: students who want the original look can export their
 * slides as PDF instead. The lesson text comes from the .pptx itself, so
 * nothing is lost if a character can't be drawn here.
 */

const W = 960;
const H = 540;
const PAD = 48;
const INK = rgb(0.11, 0.13, 0.2);
const MUTED = rgb(0.38, 0.4, 0.46);
const RULE = rgb(0.85, 0.83, 0.78);
const PAPER = rgb(0.99, 0.98, 0.95);

/** Characters the built-in PDF fonts can't draw, swapped for close equivalents. */
const SWAPS: Record<string, string> = {
  "−": "-", "–": "-", "—": "-", "≤": "<=", "≥": ">=", "≠": "!=", "→": "->", "←": "<-", "⇒": "=>", "×": "x", "÷": "/",
  "√": "sqrt", "∞": "inf", "≈": "~", "π": "pi", "Δ": "Delta", "θ": "theta", "α": "alpha", "β": "beta", "λ": "lambda", "μ": "mu",
  "σ": "sigma", "Ω": "Ohm", "∑": "Sum", " ": " ", "\t": " ",
};

export function drawable(text: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text) {
    if (set.has(ch.codePointAt(0)!)) out += ch;
    else if (SWAPS[ch] !== undefined) out += SWAPS[ch];
    else out += "?";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function slidesToPdf(slides: PptxSlide[], deckTitle: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(deckTitle);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const slide of slides) {
    let image: PDFImage | null = null;
    // The largest picture is the one that matters (logos and icons are small).
    const pic = [...slide.images].sort((a, b) => b.data.length - a.data.length)[0];
    if (pic) image = await (pic.type === "png" ? doc.embedPng(pic.data) : doc.embedJpg(pic.data)).catch(() => null);

    const notes = slide.notes.trim() ? wrap(drawable(slide.notes.trim(), regular), regular, 11, W - 2 * PAD) : [];
    const notesHeight = notes.length ? 40 + notes.length * 15 : 0;
    const page = doc.addPage([W, H + notesHeight]);
    const top = H + notesHeight;
    page.drawRectangle({ x: 0, y: notesHeight, width: W, height: H, color: PAPER });

    const textWidth = image ? W / 2 - PAD : W - 2 * PAD;
    const title = wrap(drawable(slide.title || `Slide ${slide.number}`, bold), bold, 30, textWidth).slice(0, 3);
    let y = top - PAD - 28;
    for (const line of title) {
      page.drawText(line, { x: PAD, y, size: 30, font: bold, color: INK });
      y -= 36;
    }
    y -= 8;

    // Shrink the body text until it fits the slide.
    const bodyTexts = slide.body.map((b) => drawable(b, regular));
    let size = 20;
    let lines: { text: string; bullet: boolean }[] = [];
    for (; size >= 11; size -= 1) {
      lines = bodyTexts.flatMap((b) => wrap(b, regular, size, textWidth - 22).map((text, i) => ({ text, bullet: i === 0 })));
      if (lines.length * size * 1.35 <= y - notesHeight - PAD + 10) break;
    }
    for (const l of lines) {
      if (y < notesHeight + PAD - 10) break;
      if (l.bullet) page.drawCircle({ x: PAD + 6, y: y + size * 0.33, size: 3, color: MUTED });
      page.drawText(l.text, { x: PAD + 22, y, size, font: regular, color: INK });
      y -= size * 1.35;
    }

    if (image) {
      const boxW = W / 2 - PAD;
      const boxH = H - 2 * PAD;
      const scale = Math.min(boxW / image.width, boxH / image.height, 1.5);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: W / 2 + (boxW - w) / 2, y: notesHeight + PAD + (boxH - h) / 2, width: w, height: h });
    }

    page.drawText(String(slide.number), { x: W - PAD, y: notesHeight + 18, size: 11, font: regular, color: MUTED });

    if (notes.length) {
      page.drawLine({ start: { x: PAD, y: notesHeight - 4 }, end: { x: W - PAD, y: notesHeight - 4 }, thickness: 1, color: RULE });
      let ny = notesHeight - 24;
      page.drawText("Speaker notes", { x: PAD, y: ny, size: 11, font: bold, color: MUTED });
      ny -= 17;
      for (const line of notes) {
        page.drawText(line, { x: PAD, y: ny, size: 11, font: regular, color: MUTED });
        ny -= 15;
      }
    }
  }
  return doc.save();
}
