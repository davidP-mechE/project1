/**
 * Wording for where content comes from: a textbook's pages ("p. 4",
 * "pp. 4–6", "In the book") or a slide deck's slides ("slide 4",
 * "slides 4–6", "In the slides"). Slide numbers are stored as page numbers.
 */
export type SourceKindName = "BOOK" | "SLIDES";

export const isSlides = (kind?: SourceKindName | null) => kind === "SLIDES";

/** "p." / "pp." or "slide" / "slides", for a list of this many references. */
export const refPrefix = (kind: SourceKindName | null | undefined, count: number) =>
  isSlides(kind) ? (count === 1 ? "slide" : "slides") : count === 1 ? "p." : "pp.";

export const rangeText = (kind: SourceKindName | null | undefined, a: number, b: number) =>
  a === b ? `${refPrefix(kind, 1)} ${a}` : `${refPrefix(kind, 2)} ${a}–${b}`;

export const refsText = (kind: SourceKindName | null | undefined, refs: number[]) =>
  refs.length === 0 ? "" : `${refPrefix(kind, refs.length)} ${refs.join(", ")}`;

/** "book" or "slides": "In the book", "Open the slides". */
export const sourceNoun = (kind?: SourceKindName | null) => (isSlides(kind) ? "slides" : "book");

/** "page" or "slide". */
export const unitWord = (kind?: SourceKindName | null) => (isSlides(kind) ? "slide" : "page");
