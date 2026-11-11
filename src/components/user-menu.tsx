"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, email, isAdmin = false, placement = "down", showName = false }: { name: string; email: string; isAdmin?: boolean; placement?: "up" | "down"; showName?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={showName ? "flex min-w-0 items-center gap-2.5 rounded-xl p-1 pr-2 text-left text-nav-text hover:bg-nav-active" : "inline-flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-text"}
      >
        {showName ? (
          <>
            <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-text">
              {initials}
            </span>
            <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
            <span className="sr-only"> (account menu)</span>
          </>
        ) : (
          <>
            <span aria-hidden>{initials}</span>
            <span className="sr-only">Account menu</span>
          </>
        )}
      </button>
      {open && (
        <div role="menu" className={`absolute z-30 w-60 rounded-lg border-[1.5px] border-border bg-surface p-1 text-text shadow-lg ${placement === "up" ? "bottom-full left-0 mb-2" : "right-0 mt-2"}`}>
          <div className="px-3 py-2 text-sm">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-muted">{email}</p>
          </div>
          <hr className="my-1 border-border" />
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
            Settings
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
              Admin
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
            onClick={async () => {
              await authClient.signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
