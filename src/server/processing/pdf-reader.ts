import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Canvas } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import { itemsToLines, linesToText, type Line, type TextItem } from "@/lib/pdf/lines";
import type { Bookmark } from "@/lib/outline/from-bookmarks";

/**
 * A thin wrapper around pdf.js for use in Node (the worker). It hides pdf.js
 * details: loading, page text with font sizes, bookmarks, embedded images,
 * and rendering a page to an image (for OCR and the cover thumbnail).
 */

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
const loadPdfJs = () => (pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

// Font, character-map and image-decoder data files that ship with pdf.js.
const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assetUrl = (sub: string) => pathToFileURL(path.join(pdfjsDir, sub) + path.sep).href;

export class PdfOpenError extends Error {
  constructor(
    readonly reason: "password" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export type PageData = { width: number; height: number; lines: Line[]; text: string; imageCount: number };
export type ExtractedImage = { width: number; height: number; png: Buffer };

type LoadingTask = ReturnType<PdfJs["getDocument"]>;
type PDFDocumentProxy = Awaited<LoadingTask["promise"]>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;

export class PdfReader {
  private constructor(
    private readonly pdfjs: PdfJs,
    private readonly doc: PDFDocumentProxy,
    private readonly task: LoadingTask,
  ) {}

  static async open(data: Uint8Array): Promise<PdfReader> {
    const pdfjs = await loadPdfJs();
    try {
      const task = pdfjs.getDocument({
        data,
        isOffscreenCanvasSupported: false, // return raw image pixels we can encode ourselves
        standardFontDataUrl: assetUrl("standard_fonts"),
        cMapUrl: assetUrl("cmaps"),
        cMapPacked: true,
        wasmUrl: assetUrl("wasm"),
        verbosity: 0,
      });
      const doc = await task.promise;
      return new PdfReader(pdfjs, doc, task);
    } catch (err) {
      const name = (err as Error).name;
      if (name === "PasswordException") {
        throw new PdfOpenError("password", "This PDF is password-protected. Please upload an unlocked copy.");
      }
      throw new PdfOpenError(
        "invalid",
        "We couldn't read this PDF. It may be damaged. Try re-downloading or re-exporting it, then upload again.",
      );
    }
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  async pageLabels(): Promise<string[] | null> {
    try {
      return await this.doc.getPageLabels();
    } catch {
      return null;
    }
  }

  /** Bookmarks with their destinations resolved to page numbers. */
  async bookmarks(pageTops: (page: number) => number | null): Promise<Bookmark[]> {
    let outline: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;
    try {
      outline = await this.doc.getOutline();
    } catch {
      return [];
    }
    const resolve = async (items: typeof outline): Promise<Bookmark[]> => {
      const out: Bookmark[] = [];
      for (const item of items ?? []) {
        let page: number | null = null;
        let startsAtTop = true;
        try {
          let dest = item.dest;
          if (typeof dest === "string") dest = await this.doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) {
            const ref = dest[0];
            page = (typeof ref === "number" ? ref : await this.doc.getPageIndex(ref)) + 1;
            // [ref, {name: "XYZ"}, left, top, zoom]: compare `top` with the page's first line.
            const top = dest[1]?.name === "XYZ" && typeof dest[3] === "number" ? dest[3] : null;
            const firstLineTop = pageTops(page);
            if (top !== null && firstLineTop !== null) startsAtTop = top >= firstLineTop - 18;
          }
        } catch {
          page = null;
        }
        out.push({ title: item.title ?? "", page, startsAtTop, children: await resolve(item.items) });
      }
      return out;
    };
    return resolve(outline);
  }

  private async withPage<T>(n: number, fn: (page: PDFPageProxy) => Promise<T>): Promise<T> {
    const page = await this.doc.getPage(n);
    try {
      return await fn(page);
    } finally {
      page.cleanup();
    }
  }

  async readPage(n: number): Promise<PageData> {
    return this.withPage(n, async (page) => {
      const [, , w, h] = page.view;
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is TextItem & typeof i => "str" in i);
      const lines = itemsToLines(items as TextItem[]);
      const ops = await page.getOperatorList();
      const { OPS } = this.pdfjs;
      const imageCount = ops.fnArray.filter((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject).length;
      return { width: w, height: h, lines, text: linesToText(lines), imageCount };
    });
  }

  /** Embedded images at least minSize×minSize pixels, as PNGs. */
  async extractImages(n: number, opts: { minSize: number; max: number }): Promise<ExtractedImage[]> {
    return this.withPage(n, async (page) => {
      const ops = await page.getOperatorList();
      const { OPS, ImageKind } = this.pdfjs;
      const ids = new Set<string>();
      ops.fnArray.forEach((f, i) => {
        if (f === OPS.paintImageXObject) ids.add(ops.argsArray[i][0]);
      });
      const out: ExtractedImage[] = [];
      for (const id of ids) {
        if (out.length >= opts.max) break;
        const store = id.startsWith("g_") ? page.commonObjs : page.objs;
        const img = await new Promise<{ width: number; height: number; kind?: number; data?: Uint8ClampedArray }>((resolve) =>
          store.get(id, resolve),
        );
        if (!img?.data || img.width < opts.minSize || img.height < opts.minSize) continue;
        const rgba = toRgba(img.data, img.width, img.height, img.kind, ImageKind);
        if (!rgba) continue;
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(img.width, img.height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);
        out.push({ width: img.width, height: img.height, png: canvas.toBuffer("image/png") });
      }
      return out;
    });
  }

  /** Render a page to an image. `scale` 1 = 72 dpi. */
  async render(n: number, opts: { scale?: number; width?: number; maxPixels?: number }): Promise<Canvas> {
    return this.withPage(n, async (page) => {
      const base = page.getViewport({ scale: 1 });
      let scale = opts.width ? opts.width / base.width : (opts.scale ?? 1);
      if (opts.maxPixels && base.width * base.height * scale * scale > opts.maxPixels) {
        scale = Math.sqrt(opts.maxPixels / (base.width * base.height));
      }
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      return canvas;
    });
  }

  async close() {
    await this.task.destroy();
  }
}

/** pdf.js gives images as grayscale (1 bit), RGB or RGBA; canvas wants RGBA. */
function toRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  kind: number | undefined,
  ImageKind: { GRAYSCALE_1BPP: number; RGB_24BPP: number; RGBA_32BPP: number },
): Uint8ClampedArray | null {
  const px = width * height;
  if (kind === ImageKind.RGBA_32BPP && data.length >= px * 4) return data.subarray(0, px * 4);
  const out = new Uint8ClampedArray(px * 4);
  if (kind === ImageKind.RGB_24BPP && data.length >= px * 3) {
    for (let i = 0, j = 0; i < px; i++, j += 3) {
      out[i * 4] = data[j];
      out[i * 4 + 1] = data[j + 1];
      out[i * 4 + 2] = data[j + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const o = (y * width + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
    return out;
  }
  return null;
}
