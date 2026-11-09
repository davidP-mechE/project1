/** Decide whether a page's built-in text is usable or whether we need OCR. */

export const MIN_CHARS_FOR_NATIVE_TEXT = 40;

/** Share of characters that look broken (replacement chars, private-use glyphs, control chars). */
export function garbageRatio(text: string): number {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return 0;
  const bad = chars.filter((c) => {
    const code = c.codePointAt(0)!;
    return c === "�" || (code >= 0xe000 && code <= 0xf8ff) || code < 0x20;
  }).length;
  return bad / chars.length;
}

/**
 * OCR a page when it has (almost) no text but does contain images (a scan),
 * or when its text is mostly unreadable symbols (fonts without a text mapping).
 */
export function needsOcr(text: string, imageCount: number): boolean {
  const visible = text.replace(/\s/g, "").length;
  if (visible < MIN_CHARS_FOR_NATIVE_TEXT && imageCount > 0) return true;
  if (visible >= 20 && garbageRatio(text) > 0.3) return true;
  return false;
}
