// Copies the parts of pdf.js the in-browser book viewer loads at runtime
// (its worker, fonts, character maps, decoders) into public/pdfjs/, so they're
// served as plain static files. Runs automatically after `npm install`.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "pdfjs-dist");
const out = path.join(root, "public", "pdfjs");
if (!existsSync(src)) process.exit(0);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(src, "build", "pdf.worker.min.mjs"), path.join(out, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  if (existsSync(path.join(src, dir))) cpSync(path.join(src, dir), path.join(out, dir), { recursive: true });
}
console.log("Copied pdf.js viewer files to public/pdfjs/");
