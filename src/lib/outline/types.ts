/** A heading in the book, from bookmarks or detected from font sizes. */
export type OutlineEntry = {
  title: string;
  level: 1 | 2; // 1 = chapter (becomes a Unit), 2 = section (becomes a Lesson)
  page: number; // 1-based physical page
  /** True if the heading is at the top of its page (so the previous section ends on the page before). */
  startsAtTop: boolean;
};

export type DraftLesson = { title: string; pageStart: number; pageEnd: number; isFrontBackMatter: boolean };
export type DraftUnit = DraftLesson & { lessons: DraftLesson[] };
