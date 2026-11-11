import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

// "press" gives every button a small, quick squeeze when clicked (globals.css).
const base =
  "press inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[color,background-color,border-color,transform] disabled:cursor-not-allowed disabled:opacity-60";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-text hover:bg-primary-hover",
  accent: "bg-accent text-accent-text hover:bg-accent-hover",
  secondary: "border-[1.5px] border-border bg-surface text-text hover:border-text",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 dark:text-bg",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-sm", md: "h-11 px-5 text-sm" };

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
