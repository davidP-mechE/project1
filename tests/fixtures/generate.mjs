/**
 * Regenerates the small PDF fixtures used by the tests:
 *   outlined.pdf    – a mini textbook WITH bookmarks (built-in outline)
 *   no-outline.pdf  – the same book WITHOUT bookmarks (headings must be detected from font sizes)
 *   scanned.pdf     – two pages that are only pictures of text (needs OCR)
 * Run:  node tests/fixtures/generate.mjs   (needs Playwright + Chromium; outputs are committed)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
// Playwright is a global/dev tool; loaded with require so it resolves from NODE_PATH too.
const { chromium } = createRequire(import.meta.url)("playwright");

// A simple bar-chart "figure" as a PNG so the PDF contains a real embedded image.
function figurePng() {
  const c = createCanvas(480, 300);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 480, 300);
  g.fillStyle = "#4338ca";
  [120, 200, 80, 240].forEach((h, i) => g.fillRect(60 + i * 100, 270 - h, 60, h));
  g.fillStyle = "#111"; g.font = "20px sans-serif"; g.fillText("Current vs. voltage", 140, 30);
  return c.toBuffer("image/png").toString("base64");
}

const para = (s) => `<p>${s}</p>`;
const filler = (topic, n) =>
  Array.from({ length: n }, (_, i) =>
    para(`${topic} is an important idea in this chapter. Paragraph ${i + 1} explains it with everyday examples, so a student studying alone can follow each step. We connect it to what came before and preview what comes next, and we point out common mistakes to avoid when solving problems.`),
  ).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: "DejaVu Serif", Georgia, serif; font-size: 12pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 26pt; margin: 0 0 18pt; }
  h2 { font-size: 17pt; margin: 18pt 0 8pt; }
  .page { break-after: page; }
  .chapter { break-before: page; }
  .title { text-align: center; padding-top: 200pt; }
  .title .big { font-size: 34pt; font-weight: bold; }
  .toc p { display: flex; justify-content: space-between; border-bottom: 1px dotted #999; margin: 4pt 0; }
  .eq { font-family: "DejaVu Sans", sans-serif; text-align: center; margin: 10pt 0; }
  img { display: block; margin: 12pt auto; width: 300pt; }
</style></head><body>
<div class="page title"><div class="big">Basic Circuits</div><p>A Self-Study Textbook</p><p>Second Edition</p></div>
<div class="page"><p>Copyright © 2026 Example Press. All rights reserved.</p><p>ISBN 978-0-00-000000-0</p><p>No part of this book may be reproduced without permission.</p></div>
<div class="page toc"><h1>Contents</h1>
  <p><span>1 Electric Charge and Current</span><span>4</span></p>
  <p><span>1.1 Charge</span><span>4</span></p><p><span>1.2 Current</span><span>5</span></p>
  <p><span>2 Resistance and Ohm's Law</span><span>6</span></p>
  <p><span>2.1 Resistors</span><span>6</span></p><p><span>2.2 Ohm's Law</span><span>7</span></p>
  <p><span>3 Series and Parallel Circuits</span><span>8</span></p>
  <p><span>Index</span><span>10</span></p>
</div>
<section class="chapter"><h1>1 Electric Charge and Current</h1>
  <h2>1.1 Charge</h2>${filler("Electric charge", 6)}
  <h2 style="break-before: page">1.2 Current</h2>${filler("Electric current", 5)}
</section>
<section class="chapter"><h1>2 Resistance and Ohm's Law</h1>
  <h2>2.1 Resistors</h2>${filler("Resistance", 4)}
  <img alt="Figure 2.1" src="data:image/png;base64,${figurePng()}">
  <p>Figure 2.1 A bar chart of current against voltage.</p>
  <h2 style="break-before: page">2.2 Ohm's Law</h2>
  <p>The relationship between voltage, current and resistance is:</p>
  <p class="eq">V = I × R &nbsp;&nbsp; P = I² R = V² / R</p>
  <p class="eq">R<sub>total</sub> = R₁ + R₂ + R₃ &nbsp;&nbsp; 1/R = Σ 1/Rᵢ &nbsp;&nbsp; Δ V ≈ 0.5 Ω × 2 A</p>
  <p class="eq">I(t) = I₀ e^(−t/τ), &nbsp; τ = R C, &nbsp; ∫ I dt = Q</p>
  ${filler("Ohm's law", 3)}
</section>
<section class="chapter"><h1>3 Series and Parallel Circuits</h1>
  ${filler("Series and parallel circuits", 9)}
</section>
<section class="chapter"><h1>Index</h1>
  <p>charge, 4, 5</p><p>current, 5, 6</p><p>Ohm's law, 7</p><p>parallel circuit, 8</p><p>resistor, 6, 7</p><p>series circuit, 8, 9</p>
</section>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
const pdfOpts = { format: "Letter", margin: { top: "0.8in", bottom: "0.8in", left: "0.8in", right: "0.8in" }, printBackground: true };
writeFileSync(join(here, "outlined.pdf"), await page.pdf({ ...pdfOpts, outline: true, tagged: true }));
writeFileSync(join(here, "no-outline.pdf"), await page.pdf({ ...pdfOpts, outline: false, tagged: false }));

// Scanned pages: screenshot rendered text, then put only the IMAGE into a PDF.
const scanDoc = await PDFDocument.create();
for (const text of [
  "Chapter 4 Capacitors. A capacitor stores energy in an electric field between two plates.",
  "The capacitance of a capacitor is measured in farads. Larger plates store more charge.",
]) {
  await page.setViewportSize({ width: 850, height: 1100 });
  await page.setContent(`<body style="margin:80px;font:28px/1.6 'DejaVu Serif',serif;background:#fff;color:#111">${text}</body>`);
  const png = await page.screenshot({ type: "png" });
  const img = await scanDoc.embedPng(png);
  const p = scanDoc.addPage([612, 792]);
  p.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
}
writeFileSync(join(here, "scanned.pdf"), await scanDoc.save());
await browser.close();
console.log("fixtures written to", here);
