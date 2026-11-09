"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createHighlightAction, deleteHighlightAction, saveLessonNoteAction, updateHighlightAction } from "@/server/actions/notes";
import { describeRange, locate, type Anchor } from "@/lib/highlights/anchor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HIGHLIGHT_LABEL, HIGHLIGHT_SWATCH, type HighlightColorName } from "./highlight-colors";
import type { HighlightView } from "@/server/notes";

/**
 * Highlights and notes on a lesson.
 *
 * Highlights are drawn with the browser's CSS Custom Highlight API: we never
 * change the lesson's HTML (React owns it), we just tell the browser which text
 * ranges to paint. Each highlight is stored as a quote with some context
 * (lib/highlights/anchor.ts) and found again in the text on every load.
 */

const COLORS = Object.keys(HIGHLIGHT_SWATCH) as HighlightColorName[];

type Ctx = {
  lessonId: string;
  highlights: HighlightView[];
  orphans: Set<string>;
  setHighlights: (fn: (h: HighlightView[]) => HighlightView[]) => void;
  setOrphans: (s: Set<string>) => void;
};
const HighlightContext = createContext<Ctx | null>(null);

export function HighlightProvider({ lessonId, initial, children }: { lessonId: string; initial: HighlightView[]; children: ReactNode }) {
  const [highlights, setHighlights] = useState(initial);
  const [orphans, setOrphans] = useState<Set<string>>(new Set());
  return <HighlightContext.Provider value={{ lessonId, highlights, setHighlights, orphans, setOrphans }}>{children}</HighlightContext.Provider>;
}

// ─── Text model: the lesson's visible text as one string, and back to DOM ranges ─────

type TextModel = { nodes: Text[]; starts: number[]; text: string };

function excluded(node: Node, root: HTMLElement): boolean {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    // KaTeX output (its hidden MathML duplicates the formula) and interactive bits aren't highlightable.
    if (el.classList.contains("katex") || el.hasAttribute("data-no-highlight") || el.tagName === "SCRIPT" || el.tagName === "STYLE") return true;
  }
  return false;
}

function textModel(root: HTMLElement): TextModel {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (excluded(n, root)) continue;
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  return { nodes, starts, text };
}

/** Text offset of a DOM boundary point (counting only included text). */
function offsetOf(model: TextModel, root: HTMLElement, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(container, offset);
  let n = 0;
  for (const t of model.nodes) {
    if (t === container) return n + offset;
    if (r.intersectsNode(t)) n += t.data.length;
    else if (n > 0) break;
  }
  return n;
}

function rangeAt(model: TextModel, start: number, end: number): Range | null {
  const find = (pos: number, isEnd: boolean) => {
    for (let i = 0; i < model.nodes.length; i++) {
      const s = model.starts[i];
      const e = s + model.nodes[i].data.length;
      if (isEnd ? pos > s && pos <= e : pos >= s && pos < e) return { node: model.nodes[i], offset: pos - s };
    }
    return null;
  };
  const a = find(start, false);
  const b = find(end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

type CssHighlights = { set(name: string, h: unknown): void; delete(name: string): void };
const cssHighlights = (): CssHighlights | null => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: CssHighlights }).highlights : null);
declare const Highlight: { new (...ranges: Range[]): unknown };

// ─── The highlightable area ───────────────────────────────────────────────

type Popover = { kind: "new"; anchor: Anchor; top: number; left: number } | { kind: "edit"; id: string; top: number; left: number };

export function HighlightRoot({ children }: { children: ReactNode }) {
  const ctx = useContext(HighlightContext)!;
  const { highlights, setHighlights, setOrphans, lessonId } = ctx;
  const rootRef = useRef<HTMLDivElement>(null);
  const ranges = useRef(new Map<string, Range>());
  const jumped = useRef(false);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  // Paint every highlight (and work out which can't be found any more).
  const paint = useCallback(() => {
    const root = rootRef.current;
    const reg = cssHighlights();
    if (!root) return;
    if (!reg) {
      setSupported(false);
      return;
    }
    const model = textModel(root);
    const byColor = new Map<string, Range[]>(COLORS.map((c) => [c, []]));
    const orphans = new Set<string>();
    ranges.current.clear();
    for (const h of highlights) {
      const pos = locate(model.text, h);
      const r = pos && rangeAt(model, pos.start, pos.end);
      if (!r) {
        orphans.add(h.id);
        continue;
      }
      ranges.current.set(h.id, r);
      byColor.get(h.color)!.push(r);
    }
    for (const [c, rs] of byColor) reg.set(`cb-hl-${c}`, new Highlight(...rs));
    setOrphans(orphans);

    // Coming from the Notes page (#hl-<id>): scroll to that highlight and open it, once.
    const id = window.location.hash.match(/^#hl-(.+)$/)?.[1];
    const target = id && !jumped.current ? ranges.current.get(id) : null;
    if (id && target) {
      jumped.current = true;
      target.startContainer.parentElement?.scrollIntoView({ block: "center" });
      const rootRect = root.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      setPopover({ kind: "edit", id, top: rect.bottom - rootRect.top + 8, left: Math.max(0, Math.min(rect.left - rootRect.left, rootRect.width - 280)) });
    }
  }, [highlights, setOrphans]);

  useEffect(() => {
    const frame = requestAnimationFrame(paint); // after the browser has laid out the lesson
    const root = rootRef.current;
    if (!root) return () => cancelAnimationFrame(frame);
    // If the lesson content is re-rendered (e.g. after a refresh), find the highlights again.
    const mo = new MutationObserver(() => paint());
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      const reg = cssHighlights();
      for (const c of COLORS) reg?.delete(`cb-hl-${c}`);
    };
  }, [paint]);

  const place = (rect: DOMRect) => {
    const rootRect = rootRef.current!.getBoundingClientRect();
    return { top: rect.bottom - rootRect.top + 8, left: Math.max(0, Math.min(rect.left - rootRect.left, rootRect.width - 280)) };
  };

  // Show the toolbar when text inside the lesson is selected.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const root = rootRef.current;
        const sel = window.getSelection();
        if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
          setPopover((p) => (p?.kind === "new" ? null : p));
          return;
        }
        const r = sel.getRangeAt(0);
        if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return;
        const model = textModel(root);
        const anchor = describeRange(model.text, offsetOf(model, root, r.startContainer, r.startOffset), offsetOf(model, root, r.endContainer, r.endOffset));
        if (!anchor) return;
        setError(null);
        setPopover({ kind: "new", anchor, ...place(r.getBoundingClientRect()) });
      }, 200);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(timer);
    };
  }, []);

  // Clicking painted text opens that highlight.
  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button, input, textarea, [data-no-highlight]")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
    const legacy = !pos ? document.caretRangeFromPoint?.(e.clientX, e.clientY) : null;
    const node = pos?.offsetNode ?? legacy?.startContainer;
    const offset = pos?.offset ?? legacy?.startOffset ?? 0;
    if (!node) return;
    for (const [id, r] of ranges.current) {
      try {
        if (r.isPointInRange(node, offset)) {
          setPopover({ kind: "edit", id, ...place(r.getBoundingClientRect()) });
          return;
        }
      } catch {
        /* node in another document fragment */
      }
    }
    setPopover((p) => (p?.kind === "edit" ? null : p));
  };

  const create = async (anchor: Anchor, color: HighlightColorName, withNote: boolean) => {
    const res = await createHighlightAction(lessonId, { ...anchor, color });
    if (!res.ok) return setError(res.error);
    window.getSelection()?.removeAllRanges();
    setHighlights((hs) => [...hs, res.highlight]);
    setPopover(withNote && popover ? { kind: "edit", id: res.highlight.id, top: popover.top, left: popover.left } : null);
  };

  const editing = popover?.kind === "edit" ? highlights.find((h) => h.id === popover.id) : undefined;

  return (
    <div ref={rootRef} className="relative" onClick={onClick}>
      {children}
      {!supported && highlights.length === 0 && (
        <p className="mt-2 text-xs text-muted" data-no-highlight>
          Highlighting needs a newer browser.
        </p>
      )}
      {popover?.kind === "new" && (
        <div
          data-no-highlight
          role="toolbar"
          aria-label="Highlight the selected text"
          className="absolute z-20 flex items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
          style={{ top: popover.top, left: popover.left }}
          onMouseDown={(e) => e.preventDefault() /* keep the selection */}
        >
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => create(popover.anchor, c, false)}
              className="size-7 rounded-full border border-black/10"
              style={{ background: HIGHLIGHT_SWATCH[c] }}
              aria-label={`Highlight ${HIGHLIGHT_LABEL[c].toLowerCase()}`}
              title={`Highlight ${HIGHLIGHT_LABEL[c].toLowerCase()}`}
            />
          ))}
          <Button size="sm" variant="ghost" onClick={() => create(popover.anchor, "YELLOW", true)}>
            + Note
          </Button>
          {error && <span className="px-1 text-xs text-danger">{error}</span>}
        </div>
      )}
      {editing && popover?.kind === "edit" && (
        <HighlightEditor key={editing.id} highlight={editing} top={popover.top} left={popover.left} onClose={() => setPopover(null)} />
      )}
    </div>
  );
}

function HighlightEditor({ highlight, top, left, onClose }: { highlight: HighlightView; top: number; left: number; onClose: () => void }) {
  const { setHighlights } = useContext(HighlightContext)!;
  const [note, setNote] = useState(highlight.note);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const patch = async (p: { color?: HighlightColorName; note?: string }) => {
    setSaving(true);
    const res = await updateHighlightAction(highlight.id, p);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setHighlights((hs) => hs.map((h) => (h.id === highlight.id ? { ...h, ...p } : h)));
  };
  const remove = async () => {
    const res = await deleteHighlightAction(highlight.id);
    if (!res.ok) return setError(res.error);
    setHighlights((hs) => hs.filter((h) => h.id !== highlight.id));
    onClose();
  };

  return (
    <div
      ref={ref}
      data-no-highlight
      role="dialog"
      aria-label="Highlight"
      className="absolute z-20 flex w-[min(20rem,100%)] flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg"
      style={{ top, left }}
    >
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => patch({ color: c })}
            className={cn("size-6 rounded-full border", highlight.color === c ? "border-text ring-2 ring-focus" : "border-black/10")}
            style={{ background: HIGHLIGHT_SWATCH[c] }}
            aria-label={HIGHLIGHT_LABEL[c]}
            aria-pressed={highlight.color === c}
          />
        ))}
        <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={remove}>
          Delete
        </Button>
      </div>
      <label className="sr-only" htmlFor={`note-${highlight.id}`}>
        Note
      </label>
      <textarea
        id={`note-${highlight.id}`}
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={20000}
        placeholder="Add a note…"
        className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-danger">{error}</span>}
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" disabled={saving || note === highlight.note} onClick={() => patch({ note }).then(onClose)}>
          Save note
        </Button>
      </div>
    </div>
  );
}

// ─── "My notes" panel at the end of the lesson ─────────────────────────────

export function LessonNotes({ courseId, initialNote }: { courseId: string; initialNote: string }) {
  const { lessonId, highlights, orphans } = useContext(HighlightContext)!;
  const [note, setNote] = useState(initialNote);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saved = useRef(initialNote);

  // Save automatically a moment after typing stops.
  useEffect(() => {
    if (note === saved.current) return;
    const timer = setTimeout(async () => {
      setStatus("saving");
      const res = await saveLessonNoteAction(lessonId, note);
      if (res.ok) {
        saved.current = note;
        setStatus("saved");
      } else setStatus("error");
    }, 800);
    return () => clearTimeout(timer);
  }, [note, lessonId]);

  const lost = highlights.filter((h) => orphans.has(h.id));
  return (
    <section aria-labelledby="my-notes" className="rounded-xl border border-border bg-surface p-4" data-no-highlight>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="my-notes" className="font-semibold">
          My notes
        </h2>
        <span className="text-xs text-muted" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save. Keep this tab open and try again." : `${highlights.length} highlights · select text to add more`}
        </span>
      </div>
      <label htmlFor="lesson-note" className="sr-only">
        Notes for this lesson
      </label>
      <textarea
        id="lesson-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        maxLength={20000}
        placeholder="Write your own notes on this lesson (Markdown works)…"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      />
      {lost.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-xs text-muted">These highlights are no longer in the lesson (it was rewritten). They&apos;re kept here and on the Notes page:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {lost.map((h) => (
              <li key={h.id} className="border-l-4 pl-2 text-muted" style={{ borderColor: HIGHLIGHT_SWATCH[h.color] }}>
                {h.exact.length > 160 ? `${h.exact.slice(0, 160)}…` : h.exact}
              </li>
            ))}
          </ul>
        </div>
      )}
      <a href={`/courses/${courseId}/notes`} className="mt-2 inline-block text-xs text-muted hover:text-text hover:underline">
        All notes for this course →
      </a>
    </section>
  );
}
