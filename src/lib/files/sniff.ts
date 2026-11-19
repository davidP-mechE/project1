/**
 * Message attachments: what's allowed, and the file type read from the
 * file's first bytes (its signature), never from its name or the browser's
 * claimed type alone.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
/** For <input accept>. */
export const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf";
/** How many leading bytes sniffType needs. */
export const SNIFF_BYTES = 16;

const EXTENSIONS: Record<AttachmentType, string[]> = { "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "application/pdf": ["pdf"] };

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

/** The real type of a file from its first bytes, or null if it isn't a PNG, JPEG or PDF. */
export function sniffType(head: Uint8Array): AttachmentType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  return null;
}

/** The type a file name and claimed type point to, or null if they aren't allowed or disagree. */
export function claimedType(filename: string, contentType: string): AttachmentType | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const byExt = (Object.keys(EXTENSIONS) as AttachmentType[]).find((t) => EXTENSIONS[t].includes(ext)) ?? null;
  if (!byExt) return null;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  const ok = ["", "application/octet-stream", byExt, ...(byExt === "image/jpeg" ? ["image/jpg", "image/pjpeg"] : [])];
  return ok.includes(ct) ? byExt : null;
}

/** A safe display/download name: no path, no control or quote characters, at most 120 characters, keeping the extension. */
export function cleanFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return cleaned || "file";
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export const isImage = (type: string) => type === "image/png" || type === "image/jpeg";
