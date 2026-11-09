import type { Line } from "@/lib/pdf/lines";
import type { DraftLesson, DraftUnit } from "@/lib/outline/types";

/**
 * Turns a slide deck into units and lessons. Slides don't have chapters, so:
 * - section-divider slides (a title and little else) start a new unit;
 * - the slides in between are grouped into lessons of about 6 slides,
 *   named after their first slide;
 * - title/agenda slides at the start and "Questions? / Thank you / References"
 *   at the end are marked as front/back matter (skipped by default).
 * The student can change all of it in the outline editor.
 */

export type SlideInfo = { number: number; title: string; text: string };

export const TARGET_SLIDES_PER_LESSON = 6;
export const MAX_SLIDES_PER_LESSON = 10;
const LESSONS_PER_UNIT_WITHOUT_SECTIONS = 4;

const FRONT = /^(agenda|outline|overview|contents|table of contents|today'?s? (plan|agenda|topics)|plan for today)\b/i;
const BACK = /^(questions\??|any questions\??|q\s*&\s*a|thank(s| you)\b|the end\b|references|bibliography|sources|works cited|acknowledg(e)?ments|further reading)/i;

/** The slide's title from its text lines: the biggest text near the top (PDF decks). */
export function titleFromLines(lines: Line[]): string {
  const usable = lines.filter((l) => l.text.trim().length > 1 && !/^\d+$/.test(l.text.trim()));
  if (usable.length === 0) return "";
  const biggest = Math.max(...usable.map((l) => l.size));
  // Lines in the biggest font, top to bottom (a title can wrap onto two lines).
  const title = usable.filter((l) => l.size >= biggest - 0.5).slice(0, 2);
  return title.map((l) => l.text.trim()).join(" ").replace(/\s+/g, " ").slice(0, 120);
}

/** Text on the slide besides its title. */
const bodyChars = (s: SlideInfo) => s.text.replace(s.title, "").replace(/Speaker notes:[\s\S]*$/, "").replace(/[\s•]/g, "").length;

export type SlideRole = "cover" | "front" | "section" | "back" | "content";

export function classifySlide(s: SlideInfo, index: number, total: number): SlideRole {
  const title = s.title.trim();
  if (BACK.test(title) && index >= total / 2) return "back";
  if (index === 0 && bodyChars(s) < 200) return "cover";
  if (FRONT.test(title) && index < Math.max(3, total / 4)) return "front";
  if (title && bodyChars(s) < 40 && index > 0 && index < total - 1) return "section";
  return "content";
}

/** Splits n slides into about-equal groups of roughly TARGET_SLIDES_PER_LESSON. */
export function groupSizes(n: number): number[] {
  if (n <= 0) return [];
  const groups = Math.max(1, Math.round(n / TARGET_SLIDES_PER_LESSON), Math.ceil(n / MAX_SLIDES_PER_LESSON));
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

const lessonTitle = (slides: SlideInfo[]) => {
  const titled = slides.find((s) => s.title.trim() && !/\(cont(\.|inued)?\)$/i.test(s.title.trim()));
  return (titled ?? slides[0]).title.trim() || `Slides ${slides[0].number}–${slides[slides.length - 1].number}`;
};

export function slideOutline(slides: SlideInfo[], deckTitle: string): DraftUnit[] {
  if (slides.length === 0) return [];
  const roles = slides.map((s, i) => classifySlide(s, i, slides.length));

  // Front matter: the cover and agenda slides at the start; back matter: from the first closing slide on.
  let start = 0;
  while (start < slides.length && (roles[start] === "cover" || roles[start] === "front")) start++;
  let end = slides.length;
  const firstBack = roles.findIndex((r, i) => r === "back" && i >= start);
  if (firstBack !== -1) end = firstBack;
  if (start >= end) {
    // Nothing but front/back matter: teach the whole deck as one lesson.
    start = 0;
    end = slides.length;
  }

  // Sections: runs of content slides, each started by a section-divider slide.
  type Section = { title: string; slides: SlideInfo[] };
  const sections: Section[] = [];
  for (let i = start; i < end; i++) {
    if (roles[i] === "section" || sections.length === 0) sections.push({ title: roles[i] === "section" ? slides[i].title.trim() : "", slides: [] });
    sections[sections.length - 1].slides.push(slides[i]);
  }

  const lessonsOf = (section: SlideInfo[]): DraftLesson[] => {
    const out: DraftLesson[] = [];
    let at = 0;
    for (const size of groupSizes(section.length)) {
      const group = section.slice(at, at + size);
      at += size;
      out.push({ title: lessonTitle(group), pageStart: group[0].number, pageEnd: group[group.length - 1].number, isFrontBackMatter: false });
    }
    return out;
  };

  let units: DraftUnit[];
  const hasSections = sections.filter((s) => s.title).length >= 2;
  if (hasSections) {
    units = sections.map((s, i) => {
      const lessons = lessonsOf(s.slides);
      return { title: s.title || (i === 0 ? "Introduction" : lessons[0].title), pageStart: lessons[0].pageStart, pageEnd: lessons[lessons.length - 1].pageEnd, isFrontBackMatter: false, lessons };
    });
  } else {
    const lessons = lessonsOf(sections.flatMap((s) => s.slides));
    units = [];
    for (let i = 0; i < lessons.length; i += LESSONS_PER_UNIT_WITHOUT_SECTIONS) {
      const group = lessons.slice(i, i + LESSONS_PER_UNIT_WITHOUT_SECTIONS);
      const title = lessons.length <= LESSONS_PER_UNIT_WITHOUT_SECTIONS ? deckTitle : `${deckTitle} (part ${i / LESSONS_PER_UNIT_WITHOUT_SECTIONS + 1})`;
      units.push({ title, pageStart: group[0].pageStart, pageEnd: group[group.length - 1].pageEnd, isFrontBackMatter: false, lessons: group });
    }
  }

  const matter = (title: string, from: number, to: number): DraftUnit => {
    const lesson = { title, pageStart: from, pageEnd: to, isFrontBackMatter: true };
    return { ...lesson, lessons: [lesson] };
  };
  if (start > 0) units.unshift(matter("Title and agenda", 1, start));
  if (end < slides.length) units.push(matter("Closing slides", end + 1, slides.length));
  return units;
}
