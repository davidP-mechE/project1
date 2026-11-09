import { strFromU8, unzipSync } from "fflate";

/**
 * Reads a PowerPoint (.pptx) file: the text of each slide (title first),
 * its speaker notes, and its pictures. A .pptx is a zip of XML files; we only
 * need a small part of the format (DrawingML text runs and relationships), so
 * this uses plain string matching rather than a full XML library.
 */

export type PptxImage = { data: Uint8Array; type: "png" | "jpg" };
export type PptxSlide = {
  number: number; // 1-based, in presentation order (hidden slides left out)
  title: string;
  body: string[]; // paragraphs (bullets, table cells), in reading order
  notes: string;
  images: PptxImage[];
};

export class PptxError extends Error {}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** The text of each <a:p> paragraph in a piece of DrawingML, with <a:br/> as a space. */
export function paragraphs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p [^>]*>([\s\S]*?)<\/a:p>/g)) {
    const inner = m[1] ?? m[2] ?? "";
    const text = [...inner.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)]
      .map((t) => (t[0].startsWith("<a:br") ? " " : decodeXml(t[1] ?? "")))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/** Relationship id → target path, resolved relative to the part's folder. */
function relationships(xml: string | undefined, baseDir: string): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  if (!xml) return map;
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (!id || !target || /TargetMode="External"/.test(attrs)) continue;
    map.set(id, { type, target: resolvePath(baseDir, target) });
  }
  return map;
}

function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const relsPath = (part: string) => {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};
const dirOf = (part: string) => part.slice(0, part.lastIndexOf("/"));

/** Splits a slide's shapes into the title placeholder's text and everything else. */
export function slideText(xml: string): { title: string; body: string[] } {
  let title = "";
  const body: string[] = [];
  // Shapes (<p:sp>) carry text; tables live in graphic frames (<p:graphicFrame>).
  for (const m of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>|<p:graphicFrame>([\s\S]*?)<\/p:graphicFrame>/g)) {
    const shape = m[1] ?? m[2] ?? "";
    const ph = /<p:ph\b[^>]*?type="([^"]+)"/.exec(shape)?.[1];
    if (ph === "sldNum" || ph === "dt" || ph === "ftr") continue; // slide number, date, footer
    const paras = paragraphs(shape);
    if (paras.length === 0) continue;
    if (!title && (ph === "title" || ph === "ctrTitle")) title = paras.join(" ");
    else body.push(...paras);
  }
  // No title placeholder: use the first short line.
  if (!title && body.length > 0 && body[0].length <= 90) title = body.shift()!;
  return { title, body };
}

/** Speaker notes: the notes page's body placeholder. */
export function notesText(xml: string): string {
  const out: string[] = [];
  for (const m of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
    const shape = m[1];
    if (/<p:ph\b[^>]*?type="body"/.test(shape)) out.push(...paragraphs(shape));
  }
  return out.join("\n");
}

export function parsePptx(bytes: Uint8Array, opts: { maxSlides?: number } = {}): PptxSlide[] {
  let files: Record<string, Uint8Array>;
  try {
    // First pass: only the XML parts (pictures are fetched below, only those used).
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith("ppt/") && (f.name.endsWith(".xml") || f.name.endsWith(".rels")) });
  } catch {
    throw new PptxError("This PowerPoint file couldn't be opened. It may be damaged. Try exporting the slides as a PDF instead.");
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const presentation = text("ppt/presentation.xml");
  if (!presentation) throw new PptxError("This file isn't a PowerPoint presentation (.pptx). Try exporting the slides as a PDF instead.");

  const presRels = relationships(text("ppt/_rels/presentation.xml.rels"), "ppt");
  const order = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => presRels.get(m[1])?.target).filter((t): t is string => Boolean(t));
  if (order.length === 0) throw new PptxError("This presentation has no slides.");

  type Pending = { title: string; body: string[]; notes: string; imagePaths: string[] };
  const pending: Pending[] = [];
  for (const part of order) {
    const xml = text(part);
    if (!xml) continue;
    if (/<p:sld\b[^>]*\bshow="0"/.test(xml)) continue; // hidden slide
    const rels = relationships(text(relsPath(part)), dirOf(part));
    const { title, body } = slideText(xml);
    const notesPart = [...rels.values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notes = notesPart && text(notesPart) ? notesText(text(notesPart)!) : "";
    // Pictures actually placed on the slide (blip references), in order.
    const imagePaths = [...xml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)]
      .map((m) => rels.get(m[1])?.target)
      .filter((t): t is string => Boolean(t) && /\.(png|jpe?g)$/i.test(t!));
    pending.push({ title, body, notes, imagePaths: [...new Set(imagePaths)] });
    if (opts.maxSlides && pending.length > opts.maxSlides) break;
  }
  if (pending.length === 0) throw new PptxError("Every slide in this presentation is hidden.");

  // Second pass: the pictures we need.
  const wanted = new Set(pending.flatMap((p) => p.imagePaths));
  const media = wanted.size
    ? unzipSync(bytes, { filter: (f) => wanted.has(f.name) && f.originalSize <= MAX_IMAGE_BYTES })
    : {};

  return pending.map((p, i) => ({
    number: i + 1,
    title: p.title,
    body: p.body,
    notes: p.notes,
    images: p.imagePaths
      .filter((path) => media[path])
      .map((path) => ({ data: media[path], type: /\.png$/i.test(path) ? ("png" as const) : ("jpg" as const) })),
  }));
}

/** The text a lesson is written from: title, the slide's text, then the speaker notes. */
export function slideSourceText(s: Pick<PptxSlide, "title" | "body" | "notes">): string {
  const parts = [s.title, ...s.body.map((b) => `• ${b}`)];
  if (s.notes.trim()) parts.push("", `Speaker notes: ${s.notes.trim()}`);
  return parts.filter((x, i) => x || i > 0).join("\n").trim();
}
