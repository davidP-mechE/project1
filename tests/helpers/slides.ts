import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { drawable } from "@/server/processing/slides-pdf";

/** Builds small slide decks in memory for tests: a .pptx (zip of XML parts) and a PDF export. */

export type TestSlide = { title: string; body?: string[]; notes?: string; hidden?: boolean; image?: Uint8Array; table?: string[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (t: string) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(t)}</a:t></a:r></a:p>`;

/** A 1×1 PNG. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

export function makePptx(slides: TestSlide[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, text: string) => (files[name] = strToU8(text));
  add("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  // Slide order in the presentation is deliberately different from file numbering.
  const order = slides.map((_, i) => slides.length - i); // file slideN.xml holds slides[length - N]
  add(
    "ppt/presentation.xml",
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
  );
  add(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?><Relationships>${slides
      .map((_, i) => `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${order[i]}.xml"/>`)
      .join("")}</Relationships>`,
  );
  slides.forEach((s, i) => {
    const n = order[i];
    const shapes = [
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody>${para(s.title)}</p:txBody></p:sp>`,
      s.body?.length ? `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${s.body.map(para).join("")}</p:txBody></p:sp>` : "",
      s.table ? `<p:graphicFrame><a:tbl><a:tr>${s.table.map((c) => `<a:tc><a:txBody>${para(c)}</a:txBody></a:tc>`).join("")}</a:tr></a:tbl></p:graphicFrame>` : "",
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody>${para(String(i + 1))}</p:txBody></p:sp>`,
      s.image ? `<p:pic><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill></p:pic>` : "",
    ].join("");
    add(`ppt/slides/slide${n}.xml`, `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"${s.hidden ? ' show="0"' : ""}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`);
    const rels = [
      s.notes ? `<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>` : "",
      s.image ? `<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.png"/>` : "",
    ].join("");
    add(`ppt/slides/_rels/slide${n}.xml.rels`, `<?xml version="1.0"?><Relationships>${rels}</Relationships>`);
    if (s.notes) {
      add(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `<?xml version="1.0"?><p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${para(s.notes)}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      );
    }
    if (s.image) files[`ppt/media/image${n}.png`] = s.image;
  });
  return zipSync(files);
}

/** A PDF export of a deck: one landscape page per slide, title in a big font. */
export async function makeSlidesPdf(slides: TestSlide[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  for (const s of slides) {
    const page = doc.addPage([960, 540]);
    page.drawText(drawable(s.title, bold), { x: 48, y: 460, size: 32, font: bold });
    let y = 400;
    for (const b of s.body ?? []) {
      page.drawText(drawable(b, regular), { x: 60, y, size: 18, font: regular });
      y -= 28;
    }
    page.drawText(String(slides.indexOf(s) + 1), { x: 900, y: 20, size: 10, font: regular });
  }
  return Buffer.from(await doc.save());
}

/** A typical lecture: title, agenda, two sections with content slides, then questions. */
export const LECTURE: TestSlide[] = [
  { title: "Intro to Circuits", body: ["Lecture 3", "Dr. Rivera"] },
  { title: "Agenda", body: ["Charge and current", "Ohm's law"] },
  { title: "Charge and current" },
  { title: "Electric charge", body: ["Charge is a property of matter", "Measured in coulombs (C)", "Like charges repel; unlike charges attract"], notes: "Remind students that electrons carry negative charge." },
  { title: "Electric current", body: ["Current is the rate of flow of charge", "I = Q / t", "Measured in amperes (A)"] },
  { title: "Current direction", body: ["Conventional current flows from + to −", "Electrons move the other way"] },
  { title: "Ohm's law" },
  { title: "Resistance", body: ["Resistance opposes current", "Measured in ohms (Ω)", "Depends on material, length and area"] },
  { title: "Ohm's law", body: ["V = I × R", "Doubling the voltage doubles the current", "Only for ohmic conductors"] },
  { title: "Worked example", body: ["A 12 V battery drives a 4 Ω resistor", "I = V / R = 3 A"] },
  { title: "Questions?" },
];
