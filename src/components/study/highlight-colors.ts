/** Highlight colours: the swatch for buttons/lists, and the CSS highlight name used in lessons (see globals.css). */
export const HIGHLIGHT_SWATCH = { YELLOW: "#facc15", GREEN: "#4ade80", BLUE: "#60a5fa", PINK: "#f472b6" } as const;
export type HighlightColorName = keyof typeof HIGHLIGHT_SWATCH;
export const HIGHLIGHT_LABEL: Record<HighlightColorName, string> = { YELLOW: "Yellow", GREEN: "Green", BLUE: "Blue", PINK: "Pink" };
