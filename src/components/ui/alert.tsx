import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  error: "border-danger/30 bg-danger-bg text-danger",
  success: "border-success/30 bg-success-bg text-success",
  info: "border-border bg-surface-2 text-text",
  warning: "border-warning/30 bg-warning-bg text-warning",
};

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3 text-sm leading-relaxed", tones[tone], className)}
    >
      {children}
    </div>
  );
}
