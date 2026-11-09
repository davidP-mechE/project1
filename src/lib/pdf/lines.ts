/**
 * Turns the raw text fragments pdf.js gives us into lines and readable text.
 * pdf.js reports each fragment with a transform matrix [a, b, c, d, x, y]:
 * x/y is where it sits on the page (y counts UP from the bottom), and the
 * font size is the length of the vertical scale vector (c, d).
 */

export type TextItem = { str: string; transform: number[]; width: number; hasEOL?: boolean };
export type Line = { text: string; size: number; x: number; y: number };

export function fontSizeOf(t: number[]): number {
  return Math.round(Math.hypot(t[2], t[3]) * 10) / 10;
}

/** Group fragments into lines (same baseline), ordered top-to-bottom, left-to-right. */
export function itemsToLines(items: TextItem[]): Line[] {
  const frags = items
    .filter((it) => it.str.length > 0)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], size: fontSizeOf(it.transform), width: it.width }));
  // Sort top-to-bottom, then left-to-right.
  frags.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: (typeof frags)[] = [];
  for (const f of frags) {
    const current = groups.at(-1);
    const ref = current?.[0];
    // Same line if baselines are within ~40% of the font size (handles sub/superscripts).
    if (ref && Math.abs(ref.y - f.y) <= Math.max(ref.size, f.size) * 0.4) current.push(f);
    else groups.push([f]);
  }

  const lines: Line[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    let text = "";
    let lastEnd: number | null = null;
    for (const f of g) {
      // Insert a space if there's a visible gap and neither side already has one.
      if (lastEnd !== null && f.x - lastEnd > f.size * 0.15 && !text.endsWith(" ") && !f.str.startsWith(" ")) text += " ";
      text += f.str;
      lastEnd = f.x + f.width;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    // The line's size is the size used by most of its characters.
    const bySize = new Map<number, number>();
    for (const f of g) bySize.set(f.size, (bySize.get(f.size) ?? 0) + f.str.length);
    const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
    lines.push({ text, size, x: Math.round(g[0].x * 10) / 10, y: Math.round(g[0].y * 10) / 10 });
  }
  return lines;
}

/**
 * Join lines into paragraphs. A bigger-than-usual vertical gap starts a new
 * paragraph; words broken with a hyphen at the end of a line are re-joined.
 */
export function linesToText(lines: Line[]): string {
  if (lines.length === 0) return "";
  const paragraphs: string[] = [];
  let current = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const gap = prev.y - line.y;
    const newParagraph = gap > Math.max(prev.size, line.size) * 1.75 || gap < 0 || Math.abs(prev.size - line.size) > 1;
    if (newParagraph) {
      paragraphs.push(current);
      current = line.text;
    } else if (/[A-Za-z]-$/.test(current) && /^[a-z]/.test(line.text)) {
      current = current.slice(0, -1) + line.text; // "elec-" + "tricity" -> "electricity"
    } else {
      current += " " + line.text;
    }
  }
  paragraphs.push(current);
  return paragraphs.join("\n\n");
}
