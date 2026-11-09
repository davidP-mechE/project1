/**
 * Comparing a student's typed answer with the model answer, without Claude.
 *
 * Only used to say "correct" when it's clearly correct (same words, or the
 * same single number with the same unit). Anything else goes to Claude,
 * because a different-looking answer can still be right ("500 mA" vs "0.5 A").
 */

export const MAX_RESPONSE_CHARS = 4_000;

/** Lowercase, drop LaTeX/Markdown markup and punctuation, collapse spaces. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:,|;|!|quad|qquad)/g, " ")
    .replace(/\\(?:times|cdot)/g, "*")
    .replace(/[×·]/g, "*")
    .replace(/[−–—]/g, "-")
    .replace(/\*\*|__/g, " ") // Markdown bold
    .replace(/[$*_`~{}]/g, (c) => (c === "*" ? " * " : " "))
    .replace(/[.,;:!?'"()[\]]+(?=\s|$)/g, " ")
    .replace(/^(?:the answer is|answer:|it is|it's)\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an|the)\s+/, "");
}

const NUMBER = /-?\d+(?:[.,]\d+)*(?:\s*[eE]\s*-?\d+)?/g;

/** The numbers in a text, e.g. "0.5 A at 1,200 rpm" -> [0.5, 1200]. */
export function extractNumbers(text: string): number[] {
  const clean = text.replace(/\\times\s*10\^\{?(-?\d+)\}?/g, "e$1").replace(/[×x]\s*10\^\{?(-?\d+)\}?/g, "e$1");
  return (clean.match(NUMBER) ?? [])
    .map((n) => n.replace(/\s/g, ""))
    .map((n) => (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(n) ? n.replace(/,/g, "") : n.replace(",", ".")))
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** The unit right after a number, e.g. "2.5 kΩ" -> "kω". Empty if none. */
function unitAfterNumber(text: string): string {
  const m = /-?\d[\d.,]*(?:\s*[eE]\s*-?\d+)?\s*([a-zA-Zµμω°%/^\d]+(?:\s*\/\s*[a-zA-Z]+)?)?/.exec(text.replace(/\\text\{([^}]*)\}/g, "$1"));
  return (m?.[1] ?? "").toLowerCase().replace(/\s/g, "");
}

export function numbersMatch(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 0.005; // within 0.5% (rounding)
}

/**
 * "correct" when the answer clearly matches the model answer; null when only
 * Claude can tell. Never returns "incorrect": a mismatch might still be right.
 */
export function quickCheck(reference: string, response: string): "correct" | null {
  const ref = normalizeAnswer(reference);
  const res = normalizeAnswer(response);
  if (!ref || !res) return null;
  if (ref === res) return "correct";

  // A numeric answer like "2 A" or "0.5 A": same single number, same (or no) unit.
  const refNums = extractNumbers(reference);
  const resNums = extractNumbers(response);
  const refWords = ref.replace(NUMBER, " ").replace(/[^a-zµμω%°]+/g, " ").trim().split(" ").filter(Boolean);
  const isShortNumeric = refNums.length === 1 && refWords.length <= 2;
  if (isShortNumeric && resNums.length === 1 && numbersMatch(refNums[0], resNums[0])) {
    const refUnit = unitAfterNumber(reference);
    const resUnit = unitAfterNumber(response);
    if (!refUnit || !resUnit || refUnit === resUnit) return "correct";
  }
  return null;
}

export type ResponseCheck = { ok: true; text: string } | { ok: false; error: string };

/** Basic checks on what the student typed, before anything is graded. */
export function checkResponse(raw: unknown): ResponseCheck {
  if (typeof raw !== "string") return { ok: false, error: "Write an answer first." };
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "Write an answer first." };
  if (text.length > MAX_RESPONSE_CHARS) {
    return { ok: false, error: `Please keep your answer under ${MAX_RESPONSE_CHARS.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, text };
}
