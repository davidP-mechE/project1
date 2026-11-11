import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const inputClasses =
  "h-10 w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:border-focus";

/** A labelled input with optional hint and error text, wired up for screen readers. */
export function Field({
  label,
  hint,
  error,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className={inputClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
