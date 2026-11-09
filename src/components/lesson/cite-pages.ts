import type { Element, ElementContent, Root, RootContent, Text } from "hast";

/**
 * A rehype plugin that turns page citations in lesson text, like "(p. 47)" or
 * "(pp. 47–48, 50)", and in tutor answers, like "[p. 47]", into links to the original book at that page. On the
 * lesson page they open the side-by-side book viewer (see study-shell.tsx);
 * without JavaScript they open the PDF in a new tab.
 *
 * Safety: it only ever creates links to our own book URL with a page number.
 */

const CITATION = /([([])(pp?)\.\s*(\d{1,5}(?:\s*(?:[–—-]|,|and)\s*\d{1,5})*)([)\]])/g;
const SKIP_TAGS = new Set(["a", "code", "pre"]);

export function bookPageHref(bookId: string, page: number) {
  return `/api/books/${encodeURIComponent(bookId)}/file#page=${page}`;
}

function pageLink(bookId: string, page: number, label: string): Element {
  return {
    type: "element",
    tagName: "a",
    properties: { href: bookPageHref(bookId, page), dataBookPage: String(page), className: ["page-cite"], ariaLabel: `Open the book at page ${page}` },
    children: [{ type: "text", value: label }],
  };
}

/** Split one text node into text + links. Returns null if it has no citations. */
export function linkCitations(text: string, bookId: string): ElementContent[] | null {
  CITATION.lastIndex = 0;
  if (!CITATION.test(text)) return null;
  CITATION.lastIndex = 0;
  const out: ElementContent[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const start = m.index!;
    if ((m[1] === "(") !== (m[4] === ")")) continue; // mismatched brackets: leave as text
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({ type: "text", value: `${m[1]}${m[2]}. ` });
    // Each number in "47–48, 50" becomes its own link.
    const inner = m[3];
    let pos = 0;
    for (const n of inner.matchAll(/\d{1,5}/g)) {
      if (n.index! > pos) out.push({ type: "text", value: inner.slice(pos, n.index!) });
      out.push(pageLink(bookId, Number(n[0]), n[0]));
      pos = n.index! + n[0].length;
    }
    if (pos < inner.length) out.push({ type: "text", value: inner.slice(pos) });
    out.push({ type: "text", value: m[4] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

function isMath(el: Element) {
  const cls = el.properties?.className;
  return Array.isArray(cls) && cls.some((c) => String(c).startsWith("math") || String(c).startsWith("katex"));
}

function walk(node: Root | Element, bookId: string) {
  const next: (RootContent | ElementContent)[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const parts = linkCitations((child as Text).value, bookId);
      if (parts) next.push(...parts);
      else next.push(child);
    } else {
      if (child.type === "element" && !SKIP_TAGS.has(child.tagName) && !isMath(child)) walk(child, bookId);
      next.push(child);
    }
  }
  node.children = next as typeof node.children;
}

export function rehypeCitePages(options: { bookId: string }) {
  return (tree: Root) => walk(tree, options.bookId);
}
