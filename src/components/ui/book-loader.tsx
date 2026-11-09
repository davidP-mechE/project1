import type React from "react";
import { cn } from "@/lib/utils";

/**
 * An open book, tilted towards you, whose pages keep turning: used while pages load, while a book or deck is
 * being read, and while Claude writes. With "reduce motion" it's a still, open book.
 */
export function BookLoader({
  label = "Loading",
  className,
  showLabel = false,
  size = "md",
}: {
  label?: string;
  className?: string;
  showLabel?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex flex-col items-center gap-3 text-center",
        className,
      )}
    >
      <span className={cn("book-loader", size === "lg" && "lg")} aria-hidden>
        <span className="bl-book">
          <span className="bl-cover" />
          <span className="bl-half left" />
          <span className="bl-half right" />
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="bl-page"
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </span>
      </span>
      <span className={showLabel ? "text-sm text-muted" : "sr-only"}>
        {label}
      </span>
    </span>
  );
}
