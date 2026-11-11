import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { storage } from "./storage";
import { roleOf } from "./roles";

/** Images on bank questions. Stored privately; served only through /api/bank/images/<name>. */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TYPES: { ext: string; type: string; magic: (b: Buffer) => boolean }[] = [
  { ext: "png", type: "image/png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", type: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", type: "image/gif", magic: (b) => b.subarray(0, 4).toString("ascii") === "GIF8" },
  { ext: "webp", type: "image/webp", magic: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

export const imageKey = (name: string) => `bank/images/${name}`;
export const NAME = /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/;

/** Check the bytes (not the file name) and store the image. Returns its URL. */
export async function saveBankImage(userId: string, bytes: Buffer): Promise<{ url: string } | { error: string }> {
  if (!(await roleOf(userId)).isAuthor) return { error: "Not found" };
  if (bytes.length === 0) return { error: "That file is empty." };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: "Images can be at most 2 MB." };
  const t = TYPES.find((x) => x.magic(bytes));
  if (!t) return { error: "Use a PNG, JPEG, GIF or WebP image." };
  const name = `${randomBytes(12).toString("hex")}.${t.ext}`;
  await storage.put(imageKey(name), bytes, t.type);
  return { url: `/api/bank/images/${name}` };
}

/** Authors see any image; others only images on a published question. */
export async function canSeeBankImage(userId: string, name: string) {
  if ((await roleOf(userId)).isAuthor) return true;
  const url = `/api/bank/images/${name}`;
  return (await db.bankQuestion.count({ where: { status: "published", OR: [{ imageUrl: url }, { versions: { some: { imageUrl: url } } }] } })) > 0;
}

export const imageType = (name: string) => TYPES.find((t) => name.endsWith(`.${t.ext}`))?.type ?? "application/octet-stream";
