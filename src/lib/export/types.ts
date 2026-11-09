import { rangeText, refsText, type SourceKindName } from "@/lib/source-label";
/** A whole course, ready to export (built by src/server/export.ts). */
export type ExportQuestion = {
  type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP";
  prompt: string;
  choices: string[];
  correctChoice: number | null;
  answer: string;
  explanation: string;
  steps: string[];
  pageRefs: number[];
  topic: string;
};
export type ExportCard = { id: string; front: string; back: string; pageRefs: number[] };
export type ExportLesson = {
  title: string;
  pageStart: number;
  pageEnd: number;
  objectives: string[];
  explanation: string;
  workedExamples: { title: string; problem: string; steps: string[]; answer: string; pageRefs: number[] }[];
  keyTerms: { term: string; definition: string; pageRefs: number[] }[];
  questions: ExportQuestion[];
  flashcards: ExportCard[];
};
export type ExportUnit = { title: string; summary: string | null; lessons: ExportLesson[]; test: ExportQuestion[] };
export type CourseExport = { title: string; bookFilename: string; units: ExportUnit[]; finalExam: ExportQuestion[] };

export const pagesLabel = (refs: number[], kind?: SourceKindName) => refsText(kind, refs);
export const rangeLabel = (a: number, b: number, kind?: SourceKindName) => rangeText(kind, a, b);
