import ReactMarkdown, { type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";
import { rehypeCitePages } from "./cite-pages";

/**
 * Renders lesson text: Markdown plus LaTeX math ($...$, $$...$$) via KaTeX.
 * Safety: raw HTML in the text is NOT rendered (react-markdown escapes it),
 * unsafe link schemes like javascript: are stripped, and KaTeX runs in its
 * default safe mode. So generated or edited content can't inject scripts.
 */
/**
 * remark-math only treats $$…$$ as a displayed (centered) equation when the
 * $$ markers are on their own lines. Claude and students often write
 * "$$V = IR$$" on one line, so turn such lines into the block form.
 */
export function normalizeDisplayMath(text: string): string {
  return text.replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_m, tex: string) => `$$\n${tex.trim()}\n$$`);
}

function rehypePlugins(bookId?: string): Options["rehypePlugins"] {
  const katex: [typeof rehypeKatex, { throwOnError: boolean; strict: "ignore" }] = [rehypeKatex, { throwOnError: false, strict: "ignore" }];
  return bookId ? [[rehypeCitePages, { bookId }], katex] : [katex];
}

/** With `bookId`, page citations like "(p. 47)" become links to the book at that page. */
export function Markdown({ children, className, bookId }: { children: string; className?: string; bookId?: string }) {
  return (
    <div className={cn("prose-lesson", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins(bookId)}
        components={{
          // Keep the page's heading structure: lesson text never uses top-level headings.
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ children, href, ...rest }) => {
            const page = (rest as Record<string, unknown>)["data-book-page"];
            if (typeof page === "string" && /^\d+$/.test(page)) {
              // A page citation added by rehypeCitePages (our own URL).
              return (
                <a href={href} data-book-page={page} className="page-cite" aria-label={typeof rest["aria-label" as keyof typeof rest] === "string" ? String(rest["aria-label" as keyof typeof rest]) : `Open page ${page}`} target="_blank" rel="noopener">
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
          img: () => null, // lessons never embed outside images
        }}
      >
        {normalizeDisplayMath(children)}
      </ReactMarkdown>
    </div>
  );
}
