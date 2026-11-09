import { describe, expect, it } from "vitest";
import path from "node:path";
import initSqlJs from "sql.js";
import { unzipSync, strFromU8 } from "fflate";
import { ankiChecksum, buildApkg, toAnkiHtml } from "@/lib/export/anki";
import { courseToMarkdown } from "@/lib/export/course-markdown";
import { csvField, flashcardsCsv, questionsCsv, toCsv } from "@/lib/export/csv";
import type { CourseExport } from "@/lib/export/types";
import { assessmentUserMessage, normalizeAssessment, questionCountFor } from "@/lib/ai/assessment";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { sampleDraft } from "../helpers/fake-claude";

const q = (over: Partial<CourseExport["finalExam"][number]> = {}) => ({
  type: "MULTIPLE_CHOICE" as const,
  prompt: "What is the unit of current?",
  choices: ["Volt", "Ampere", "Ohm", "Watt"],
  correctChoice: 1,
  answer: "Ampere",
  explanation: "Current is measured in amperes.",
  steps: [],
  pageRefs: [5],
  topic: "Units",
  ...over,
});
const course: CourseExport = {
  title: "Basic Circuits",
  bookFilename: "circuits.pdf",
  units: [
    {
      title: "1 Charge",
      summary: "- Charge is conserved (p. 4).",
      test: [q({ prompt: "Unit test Q" })],
      lessons: [
        {
          title: "1.1 Current",
          pageStart: 4,
          pageEnd: 5,
          objectives: ["Explain current."],
          explanation: "## Current\n\nCurrent is $I = Q/t$ (p. 5).\n\n$$P = IV$$",
          workedExamples: [{ title: "Finding I", problem: "2 C in 4 s.", steps: ["I = Q/t", "I = 0.5 A"], answer: "0.5 A", pageRefs: [5] }],
          keyTerms: [{ term: "Ampere", definition: "Unit of current.", pageRefs: [5] }],
          questions: [q(), q({ type: "SHORT_ANSWER", prompt: "Define current.", choices: [], correctChoice: null, answer: "Rate of flow of charge." })],
          flashcards: [
            { id: "c1", front: "What is **current**?", back: "Rate of flow of charge, $I = Q/t$.", pageRefs: [5] },
            { id: "c2", front: "=SUM(A1) <b>x</b>", back: 'Say "hi", ok?\nNew line', pageRefs: [] },
          ],
        },
      ],
    },
  ],
  finalExam: [q({ prompt: "Final Q" })],
};

describe("CSV", () => {
  it("escapes commas, quotes and newlines, and defuses formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("-1")).toBe("'-1");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(toCsv([["a", "b"]])).toBe("﻿a,b\r\n");
  });
  it("exports flashcards and questions", () => {
    const cards = flashcardsCsv(course).split("\r\n");
    expect(cards[0]).toBe("﻿Front,Back,Unit,Lesson,Pages");
    expect(cards[1]).toBe("What is **current**?,\"Rate of flow of charge, $I = Q/t$.\",1 Charge,1.1 Current,p. 5");
    expect(flashcardsCsv(course)).toContain(`'=SUM(A1) <b>x</b>,"Say ""hi"", ok?\nNew line"`);
    const qs = questionsCsv(course);
    expect(qs).toContain("1 Charge › 1.1 Current,Multiple choice,What is the unit of current?");
    expect(qs).toContain("B. Ampere");
    expect(qs).toContain("1 Charge › Unit test");
    expect(qs).toContain("Final exam,Multiple choice,Final Q");
  });
});

describe("Markdown study guide", () => {
  const md = courseToMarkdown(course, { answers: true, flashcards: true }, new Date("2026-11-09T12:00:00Z"));
  it("has a title, contents, units, lessons, tests and the final exam", () => {
    expect(md.startsWith("# Basic Circuits\n")).toBe(true);
    expect(md).toContain("- [1 Charge](#1-charge)");
    expect(md).toContain("## 1 Charge");
    expect(md).toContain("### 1.1 Current");
    expect(md).toContain("**Unit summary**");
    expect(md).toContain("### 1 Charge: unit test");
    expect(md).toContain("## Final exam");
  });
  it("demotes headings inside lesson text and keeps math", () => {
    expect(md).toContain("##### Current");
    expect(md).toContain("$I = Q/t$");
    expect(md).toContain("$$P = IV$$");
  });
  it("includes answers and flashcards only when asked", () => {
    expect(md).toContain("**Answer:** B. Ampere");
    expect(md).toContain("| What is **current**? |");
    const bare = courseToMarkdown(course, { answers: false, flashcards: false }, new Date());
    expect(bare).not.toContain("**Answer:** B.");
    expect(bare).not.toContain("#### Flashcards");
    expect(bare).toContain("   - B. Ampere"); // choices still shown
  });
});

describe("Anki deck", () => {
  it("converts card text to Anki HTML: escaped, bold, line breaks, MathJax", () => {
    expect(toAnkiHtml("**F** = $ma$ <script>")).toBe("<b>F</b> = \\(ma\\) &lt;script&gt;");
    expect(toAnkiHtml("Ohm:\n$$V = IR$$")).toBe("Ohm:<br>\\[V = IR\\]");
    expect(toAnkiHtml("$a<b$")).toBe("\\(a&lt;b\\)");
  });
  it("computes Anki's checksum", () => expect(ankiChecksum("<b>hello</b>")).toBe(parseInt("aaf4c61d", 16)));

  it("builds a valid schema-11 collection inside a zip", async () => {
    const SQL = await initSqlJs({ locateFile: (f) => path.join(process.cwd(), "node_modules/sql.js/dist", f) });
    const zip = unzipSync(buildApkg(SQL, course, new Date("2026-11-09T12:00:00Z")));
    expect(Object.keys(zip).sort()).toEqual(["collection.anki2", "media"]);
    expect(strFromU8(zip.media)).toBe("{}");
    const db = new SQL.Database(zip["collection.anki2"]);
    const one = <T,>(sql: string) => db.exec(sql)[0].values as T[][];
    expect(one<number>("select ver from col")[0][0]).toBe(11);
    const [models, decks, conf] = one<string>("select models, decks, conf from col")[0].map((x) => JSON.parse(x));
    const model = Object.values(models)[0] as { id: number; flds: { name: string }[]; tmpls: { qfmt: string }[] };
    expect(model.flds.map((f) => f.name)).toEqual(["Front", "Back", "Source"]);
    expect(Object.values(decks).map((d) => (d as { name: string }).name).sort()).toEqual(["Basic Circuits::1 Charge", "Default"]);
    expect(conf.curModel).toBe(String(model.id));
    const notes = one<string | number>("select mid, flds, sfld, csum, tags from notes order by id");
    expect(notes).toHaveLength(2);
    expect(notes[0][0]).toBe(model.id);
    const fields = String(notes[0][1]).split("\x1f");
    expect(fields).toEqual(["What is <b>current</b>?", "Rate of flow of charge, \\(I = Q/t\\).", "1.1 Current · p. 5"]);
    expect(notes[0][2]).toBe("What is current?");
    expect(notes[0][4]).toBe(" 1_1_Current ");
    expect(String(notes[1][1])).toContain("=SUM(A1) &lt;b&gt;x&lt;/b&gt;");
    const cards = one<number>("select nid, did, ord, type, queue, due from cards order by id");
    expect(cards).toHaveLength(2);
    const deckId = Number(Object.keys(decks).find((k) => k !== "1"));
    expect(cards.every((c) => c[1] === deckId && c[2] === 0 && c[3] === 0 && c[4] === 0)).toBe(true);
    expect(cards.map((c) => c[5])).toEqual([1, 2]);
    // Every table Anki expects exists.
    const tables = one<string>("select name from sqlite_master where type='table' order by name").map((r) => r[0]);
    expect(tables).toEqual(["cards", "col", "graves", "notes", "revlog"]);
    db.close();
  });
});

describe("unit test / final exam writing", () => {
  const lessons = [{ title: "1.1 Current", pageStart: 4, pageEnd: 5, content: { objectives: ["Explain current."], explanation: "x".repeat(10_000), workedExamples: [], keyTerms: [{ term: "Ampere", definition: "Unit of current.", pageRefs: [5] }] } }];
  it("sizes tests by the number of lessons", () => {
    expect(questionCountFor("UNIT_TEST", 1)).toBe(5);
    expect(questionCountFor("UNIT_TEST", 3)).toBe(9);
    expect(questionCountFor("UNIT_TEST", 10)).toBe(12);
    expect(questionCountFor("FINAL_EXAM", 2)).toBe(10);
    expect(questionCountFor("FINAL_EXAM", 40)).toBe(30);
  });
  it("sends the lessons (shortened if long) and what to write", () => {
    const msg = assessmentUserMessage({ kind: "UNIT_TEST", courseTitle: "C", unitTitle: "1 Charge", lessons, questionCount: 5, settings: DEFAULT_SETTINGS, avoid: ["Old practice Q"] });
    expect(msg).toContain('<lesson title="1.1 Current" pages="4-5">');
    expect(msg).toContain("[…]");
    expect(msg).toContain('a 5-question unit test for the unit "1 Charge"');
    expect(msg).toContain("- Old practice Q");
    expect(msg).toContain("multiple_choice, short_answer, step_by_step");
  });
  it("keeps valid questions within the unit's pages, up to the count", () => {
    const draft = { summary: " - Key idea (p. 4) ", questions: [...sampleDraft(4, 5).questions, ...sampleDraft(4, 5).questions] };
    const n = normalizeAssessment(draft, { kind: "UNIT_TEST", range: { pageStart: 4, pageEnd: 5 }, settings: DEFAULT_SETTINGS, questionCount: 10 });
    expect(n.questions).toHaveLength(3); // broken one dropped, duplicates removed
    expect(n.questions.every((q) => q.pageRefs.every((p) => p >= 4 && p <= 5))).toBe(true);
    expect(n.summary).toBe("- Key idea (p. 4)");
    expect(normalizeAssessment(draft, { kind: "FINAL_EXAM", range: { pageStart: 4, pageEnd: 5 }, settings: DEFAULT_SETTINGS, questionCount: 2 })).toMatchObject({ summary: "" });
    const onlyMcq = { ...DEFAULT_SETTINGS, contentTypes: DEFAULT_SETTINGS.contentTypes.filter((t) => t !== "shortAnswer" && t !== "stepProblems") };
    expect(normalizeAssessment(draft, { kind: "UNIT_TEST", range: { pageStart: 4, pageEnd: 5 }, settings: onlyMcq, questionCount: 10 }).questions.map((q) => q.type)).toEqual(["MULTIPLE_CHOICE"]);
  });
});
