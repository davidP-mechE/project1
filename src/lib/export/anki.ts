import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { Database, SqlJsStatic } from "sql.js";
import type { CourseExport } from "./types";
import { pagesLabel } from "./types";

/**
 * Anki deck (.apkg): a zip holding "collection.anki2" (an SQLite database in
 * Anki's schema 11, which every Anki version imports) and an empty "media"
 * list. One subdeck per unit ("Course::Unit"), one note per flashcard with
 * Front / Back / Source fields. Math is converted to Anki's MathJax syntax.
 * Pure (the SQLite engine is passed in) and unit-tested.
 */

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Card text → Anki field HTML: escaped, **bold**, line breaks, and $math$ → \( \) / $$math$$ → \[ \]. */
export function toAnkiHtml(text: string): string {
  const parts: string[] = [];
  // Split out math first so it isn't touched by the Markdown rules.
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    parts.push(markdownBits(text.slice(last, m.index)));
    parts.push(m[1] !== undefined ? `\\[${escapeHtml(m[1].trim())}\\]` : `\\(${escapeHtml(m[2])}\\)`);
    last = m.index! + m[0].length;
  }
  parts.push(markdownBits(text.slice(last)));
  return parts.join("");
}
function markdownBits(s: string) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\r?\n/g, "<br>");
}

/** Anki's sort-field checksum: first 8 hex digits of SHA-1 of the plain text. */
export function ankiChecksum(field: string): number {
  const plain = field.replace(/<[^>]*>/g, "");
  return parseInt(createHash("sha1").update(plain, "utf8").digest("hex").slice(0, 8), 16);
}

/** A stable short id per card, so re-importing an updated deck updates notes instead of duplicating them. */
const guidFor = (id: string) => createHash("sha1").update(`coursebook:${id}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);

const stableInt = (s: string, salt: string) => (parseInt(createHash("sha1").update(`${salt}:${s}`).digest("hex").slice(0, 11), 16) % 9e12) + 1e12;

export function buildApkg(SQL: SqlJsStatic, course: CourseExport, now: Date): Uint8Array {
  const db: Database = new SQL.Database();
  try {
    db.run(SCHEMA);
    const ms = now.getTime();
    const s = Math.floor(ms / 1000);
    const modelId = stableInt(course.title, "model");
    const decks: Record<string, unknown> = {
      "1": deckJson(1, "Default", s),
    };
    const unitDeck = new Map<number, number>();
    course.units.forEach((u, i) => {
      const id = stableInt(`${course.title}::${i}::${u.title}`, "deck");
      unitDeck.set(i, id);
      decks[String(id)] = deckJson(id, `${course.title.replace(/::/g, ":")}::${u.title.replace(/::/g, ":")}`, s);
    });
    const firstDeck = unitDeck.get(0) ?? 1;
    const model = {
      id: modelId,
      name: "Coursebook (Front/Back/Source)",
      type: 0,
      mod: s,
      usn: -1,
      sortf: 0,
      did: firstDeck,
      tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: '{{FrontSide}}<hr id="answer">{{Back}}<div class="source">{{Source}}</div>', did: null, bqfmt: "", bafmt: "" }],
      flds: ["Front", "Back", "Source"].map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
      css: ".card { font-family: system-ui, sans-serif; font-size: 20px; text-align: center; color: black; background-color: white; }\n.source { margin-top: 1em; font-size: 12px; color: #777; }",
      latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      tags: [],
      vers: [],
      req: [[0, "all", [0]]],
    };
    const conf = { nextPos: 1, estTimes: true, activeDecks: [1], sortType: "noteFld", timeLim: 0, sortBackwards: false, addToCur: true, curDeck: firstDeck, newBury: true, newSpread: 0, dueCounts: true, curModel: String(modelId), collapseTime: 1200 };
    const dconf = {
      "1": {
        id: 1,
        name: "Default",
        replayq: true,
        lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
        rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: false },
        timer: 0,
        maxTaken: 60,
        usn: 0,
        new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20, bury: false },
        mod: 0,
        autoplay: true,
      },
    };
    db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", [
      Math.floor(s / 86400) * 86400,
      ms,
      ms,
      JSON.stringify(conf),
      JSON.stringify({ [String(modelId)]: model }),
      JSON.stringify(decks),
      JSON.stringify(dconf),
    ]);
    const note = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const card = db.prepare("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    let n = 0;
    course.units.forEach((u, ui) => {
      for (const l of u.lessons) {
        const tag = l.title.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 60);
        for (const c of l.flashcards) {
          n++;
          const front = toAnkiHtml(c.front);
          const source = escapeHtml(`${l.title}${c.pageRefs.length ? ` · ${pagesLabel(c.pageRefs, course.kind)}` : ""}`);
          const noteId = ms + n;
          note.run([noteId, guidFor(c.id), modelId, s, ` ${tag} `, [front, toAnkiHtml(c.back), source].join("\x1f"), front.replace(/<[^>]*>/g, ""), ankiChecksum(front)]);
          card.run([ms + 1_000_000 + n, noteId, unitDeck.get(ui) ?? 1, s, n]);
        }
      }
    });
    note.free();
    card.free();
    conf.nextPos = n + 1;
    db.run("UPDATE col SET conf = ?", [JSON.stringify(conf)]);
    const collection = db.export();
    return zipSync({ "collection.anki2": collection, media: strToU8("{}") });
  } finally {
    db.close();
  }
}

function deckJson(id: number, name: string, mod: number) {
  return {
    id,
    name,
    mod,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: id === 1 ? "" : "Made with Coursebook.",
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
  };
}
