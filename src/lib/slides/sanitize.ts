import sanitizeHtml from "sanitize-html";

/**
 * Slide HTML for imported lesson decks is shown inline in lessons, so it's
 * cleaned twice (when imported and again when shown): only layout and text
 * tags, simple inline SVG drawings, and inline styles survive. No scripts,
 * event handlers, links, images, ids, or styles that load anything (url(),
 * @import, expression()). The page's Content-Security-Policy would block
 * scripts anyway; this keeps a hand-edited or tampered lesson harmless too.
 */

const SVG_TAGS = ["svg", "g", "line", "circle", "ellipse", "rect", "path", "polyline", "polygon"];
const SVG_ATTRS = [
  "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "transform", "opacity",
  "aria-label", "role",
];
const UNSAFE_STYLE = /url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i;

export const SLIDE_HTML_MAX = 40_000;

export function sanitizeSlideHtml(html: string): string {
  return sanitizeHtml(html.slice(0, SLIDE_HTML_MAX * 2), {
    allowedTags: ["section", "div", "p", "h1", "h2", "h3", "h4", "span", "b", "strong", "i", "em", "u", "br", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "hr", ...SVG_TAGS],
    allowedAttributes: { "*": ["style"], ...Object.fromEntries(SVG_TAGS.map((t) => [t, ["style", ...SVG_ATTRS]])) },
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    parser: { lowerCaseAttributeNames: false },
    transformTags: {
      "*": (tagName, attribs) => {
        if (attribs.style && UNSAFE_STYLE.test(attribs.style)) delete attribs.style;
        return { tagName, attribs };
      },
    },
  }).slice(0, SLIDE_HTML_MAX);
}
