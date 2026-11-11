import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  // A card given its own padding (p-0, p-4…) uses that instead of the default.
  const padded = /(^|\s)p-[\d[]/.test(className ?? "");
  return <div className={cn("lift rounded-[1.25rem] border border-border bg-surface", !padded && "p-6", className)}>{children}</div>;
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}
    >
      <div className="bar-fill h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="eyebrow mb-2 flex items-center gap-2">
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-accent" />
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        <span aria-hidden className="mt-3 block h-[3px] w-12 rounded-full bg-accent" />
        {description && <p className="mt-3 max-w-2xl text-[0.95rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
