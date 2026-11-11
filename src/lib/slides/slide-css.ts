/**
 * Base styles for imported slide decks (Hub courses made from lesson slides).
 * Each slide is a <section> on a fixed 1920×1080 canvas with every style
 * inline; these rules supply the deck format's defaults (no margins, column
 * flow, text sizes, ruled table cells). Scoped to .cb-slide so they never
 * touch the rest of the page. The build script in scripts/hub/ inlines the
 * same text when it renders the slides to PDF.
 */
export const SLIDE_BASE_CSS = `
.cb-slide, .cb-slide * { box-sizing: border-box; margin: 0; }
.cb-slide > section { position: relative; width: 1920px; height: 1080px; overflow: hidden; font-family: Inter, Arial, sans-serif; }
.cb-slide > section:not([style*="display"]), .cb-slide div:not([style*="display"]) { display: flex; flex-direction: column; }
.cb-slide h1 { font-size: 96px; font-weight: 600; line-height: 1.1; }
.cb-slide h2 { font-size: 64px; font-weight: 600; line-height: 1.15; }
.cb-slide h3 { font-size: 44px; font-weight: 600; line-height: 1.2; }
.cb-slide p { font-size: 32px; font-weight: 400; line-height: 1.4; }
.cb-slide ul, .cb-slide ol { padding-left: 40px; }
.cb-slide ul { list-style: disc; }
.cb-slide ol { list-style: decimal; }
.cb-slide table { border-collapse: collapse; }
.cb-slide td, .cb-slide th { padding: 0.35em 0.6em; text-align: left; vertical-align: middle; }
.cb-slide tr + tr td, .cb-slide tr + tr th { border-top: 1px solid rgba(0, 0, 0, 0.12); }
.cb-slide b, .cb-slide strong { font-weight: 700; }
.cb-slide svg { flex: none; }
`;
