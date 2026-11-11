/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node build script */
// Builds the SAT Hub course data from the downloaded decks: cleaned slide HTML (tutor notes removed,
// dropped template slides left out), one PDF per course (one page per slide), and each slide's text.
// The decks are the 1600 Project's slide artifacts, downloaded as <decksDir>/<deck>/project/{deck.json,slides/*.html}
// (deck names and the artifacts they came from: sat-spec.json). Output goes to content/hub/.
// Usage: node scripts/hub/build-sat.cjs <decksDir> [outDir=content/hub] [--shots <dir>]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const HERE = process.argv[2];
if (!HERE) throw new Error("Usage: node scripts/hub/build-sat.cjs <decksDir> [outDir] [--shots <dir>]");
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "sat-spec.json"), "utf8"));
const out = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : path.join(__dirname, "../../content/hub");
const shotsIdx = process.argv.indexOf("--shots");
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
fs.mkdirSync(out, { recursive: true });

// The same base styles the app uses (SLIDE_BASE_CSS in src/lib/slides/slide-css.ts).
const BASE_CSS = fs.readFileSync(path.join(__dirname, "../../src/lib/slides/slide-css.ts"), "utf8").match(/`([\s\S]*)`/)[1];

function lessonTitle(deck, raw) {
  if (spec.titles[deck]) return spec.titles[deck];
  return raw
    .replace(/^SAT Math\s+/, "")
    .replace(/^Lesson\s+(\d+\.\d+):\s*/, "$1 · ")
    .trim();
}

function clean(html) {
  return html
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/\sdata-transition="[^"]*"/g, "")
    .trim();
}

(async () => {
  const browser = await chromium.launch();
  for (const course of spec.courses) {
    const units = [];
    const all = [];
    for (const u of course.units) {
      const lessons = [];
      for (const deck of u.decks) {
        const d = JSON.parse(fs.readFileSync(path.join(HERE, deck, "project/deck.json"), "utf8"));
        const drop = new Set(spec.drop[deck] || []);
        const slides = [];
        for (const id of d.order) {
          if (drop.has(id)) continue;
          const file = path.join(HERE, deck, "project/slides", `${id}.html`);
          if (!fs.existsSync(file)) throw new Error(`Missing slide ${deck}/${id}`);
          const s = { id, html: clean(fs.readFileSync(file, "utf8")) };
          slides.push(s);
          all.push(s);
        }
        lessons.push({ deck, title: lessonTitle(deck, d.title), slides });
      }
      units.push({ title: u.title, lessons });
    }

    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
      @page { size: 1920px 1080px; margin: 0 }
      html, body { margin: 0; padding: 0; background: #fff }
      .cb-slide { width: 1920px; height: 1080px; break-after: page; }
    </style></head><body>${all.map((s) => `<div class="cb-slide">${s.html}</div>`).join("\n")}</body></html>`;
    await page.setContent(doc, { waitUntil: "load" });
    const texts = await page.$$eval(".cb-slide > section", (els) => els.map((e) => e.innerText.replace(/\n{3,}/g, "\n\n").trim()));
    all.forEach((s, i) => (s.text = texts[i]));
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      const els = await page.$$(".cb-slide");
      for (const i of [0, 1, 2, 4, 5, 9, 12, 20, 30, 40, 60, 80].filter((i) => i < els.length)) await els[i].screenshot({ path: path.join(shots, `${course.key}-${i}.png`) });
    }
    await page.pdf({ path: path.join(out, `${course.key}.pdf`), width: "1920px", height: "1080px", printBackground: true });
    await page.close();

    // Page numbers: slides in order, 1-based.
    let n = 1;
    for (const u of units) for (const l of u.lessons) {
      l.pageStart = n;
      n += l.slides.length;
      l.pageEnd = n - 1;
    }
    const data = { version: 1, key: course.key, title: course.title, subject: course.subject, description: course.description, pageCount: n - 1, units };
    fs.writeFileSync(path.join(out, `${course.key}.json`), JSON.stringify(data, null, 1));
    console.log(`${course.key}: ${units.length} units, ${units.reduce((a, u) => a + u.lessons.length, 0)} lessons, ${n - 1} slides`);
  }
  await browser.close();
})();
