"use client";

import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";

export function ThemeProvider({
  children,
  nonce,
}: {
  children: ReactNode;
  nonce?: string;
}) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemes>
  );
}

const emptySubscribe = () => () => {};

/** Cycles light → dark → system. */
/** `className` replaces the default colors (e.g. on the night-sky sidebar). */
export function ThemeToggle({ className }: { className?: string } = {}) {
  const { theme, setTheme } = useTheme();
  // The saved theme is only known in the browser; render a neutral label on the server.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : "system";
  const next =
    current === "light" ? "dark" : current === "dark" ? "system" : "light";
  return (
    <button
      type="button"
      onClick={() => {
        // Cross-fade between themes where the browser can (not for "reduce motion").
        const doc = document as Document & {
          startViewTransition?: (cb: () => void) => unknown;
        };
        if (
          !doc.startViewTransition ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return setTheme(next);
        const dark =
          next === "dark" ||
          (next === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        doc.startViewTransition(() => {
          document.documentElement.classList.toggle("dark", dark);
          document.documentElement.classList.toggle("light", !dark);
          document.documentElement.style.colorScheme = dark ? "dark" : "light";
          setTheme(next);
        });
      }}
      className={`inline-flex size-9 items-center justify-center rounded-lg ${className ?? "text-muted hover:bg-surface-2 hover:text-text"}`}
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      title={`Theme: ${current}`}
    >
      <ThemeIcon theme={current} />
    </button>
  );
}

function ThemeIcon({ theme }: { theme: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (theme === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
