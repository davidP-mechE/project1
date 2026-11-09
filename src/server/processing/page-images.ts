import { db } from "../db";
import { storage } from "../storage";
import { PdfReader } from "./pdf-reader";

/**
 * Renders single pages to PNG for the worker (equation repair). Opening a big
 * PDF is slow, so the last couple of opened books are kept in memory for a
 * few minutes.
 */

type Entry = { reader: PdfReader; lastUsed: number };
const open = new Map<string, Entry>();
const MAX_OPEN = 2;
const IDLE_MS = 5 * 60_000;

async function readerFor(bookId: string): Promise<PdfReader> {
  const hit = open.get(bookId);
  if (hit) {
    hit.lastUsed = Date.now();
    return hit.reader;
  }
  const book = await db.book.findUniqueOrThrow({ where: { id: bookId }, select: { storageKey: true } });
  const reader = await PdfReader.open(new Uint8Array(await storage.getBuffer(book.storageKey)));
  open.set(bookId, { reader, lastUsed: Date.now() });
  // Close the least recently used book if too many are open.
  if (open.size > MAX_OPEN) {
    const [oldestId, oldest] = [...open.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    open.delete(oldestId);
    await oldest.reader.close().catch(() => {});
  }
  return reader;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, e] of open) {
    if (now - e.lastUsed > IDLE_MS) {
      open.delete(id);
      void e.reader.close().catch(() => {});
    }
  }
}, 60_000).unref();

/** A page as a PNG about 1,600 px wide: sharp enough for Claude to read equations. */
export async function renderPagePng(bookId: string, pageNumber: number): Promise<Buffer> {
  const reader = await readerFor(bookId);
  const canvas = await reader.render(pageNumber, { width: 1600, maxPixels: 4_000_000 });
  return canvas.toBuffer("image/png");
}
