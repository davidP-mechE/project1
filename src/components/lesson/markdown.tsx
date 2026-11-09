import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";

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

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-lesson", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
        components={{
          // Keep the page's heading structure: lesson text never uses top-level headings.
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          img: () => null, // lessons never embed outside images
        }}
      >
        {normalizeDisplayMath(children)}
      </ReactMarkdown>
    </div>
  );
}
