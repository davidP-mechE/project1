/**
 * Estimates how equation-heavy a page is (0 = plain prose, 1 = nothing but math).
 * Text extraction tends to mangle equations, so pages above MATH_HEAVY_THRESHOLD
 * get extra care later (repair with Claude's vision, or a warning to the student).
 */

export const MATH_HEAVY_THRESHOLD = 0.12;

const MATH_SYMBOLS = /[=+−×÷±∓·∑∏∫∮√∞∂∇≈≠≤≥≡∝∈∉⊂⊆∪∩→←↔⇒⇔∀∃°′″αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ²³¹⁰⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉ᵢⱼₙ^_]/gu;

export function mathScore(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) return 0;
  const chars = text.replace(/\s/g, "").length;
  const symbols = (text.match(MATH_SYMBOLS) ?? []).length;
  // Tokens like "x", "R1", "2x", "I0", "(t)", "dt" are typical of formulas.
  const mathTokens = words.filter((w) => /^\(?[A-Za-z]{1,2}\d{0,2}\)?[,.]?$|^\d+[A-Za-z]{1,2}$|^[A-Za-z]\(\w\)$/.test(w) && !/^(a|A|I|an|of|in|is|it|to|be|we|as|at|by|or|on|if|so|do|no|up|he|me|my|us)[,.]?$/.test(w)).length;
  const symbolDensity = symbols / chars; // e.g. 0.05 means 1 in 20 characters is a math symbol
  const tokenDensity = mathTokens / words.length;
  const score = Math.min(1, symbolDensity * 6 + tokenDensity * 0.8);
  return Math.round(score * 1000) / 1000;
}
