"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, email }: { name: string; email: string }) {
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
        aria-label="Account menu"
        className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-text"
      >
        {initials}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-border bg-surface p-1 shadow-lg">
          <div className="px-3 py-2 text-sm">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-muted">{email}</p>
          </div>
          <hr className="my-1 border-border" />
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
            Settings
          </Link>
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
