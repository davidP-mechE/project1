"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { setTimeZoneAction } from "@/server/actions/review";
import { ThemeToggle } from "@/components/theme";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";
import { CoursebookMark, Wordmark } from "@/components/brand/seal";
import { BRAND } from "@/lib/brand";

/**
 * The app's navigation: an ink sidebar on desktop; on phones, a top bar
 * with the same links in a slide-out menu. Shows the streak and XP, and the
 * number of flashcards due on Review.
 */

type Props = {
  user: { name: string; email: string; isAdmin: boolean; isStaff: boolean };
  dueCount: number;
  timeZone: string;
  game: { streak: number; xp: number; level: number };
  unread: { notices: number; threads: number };
};

const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  library: (
    <>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2.5Z" />
      <path d="M4 19.5A2 2 0 0 0 6 21h13v-3" />
    </>
  ),
  slides: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8 20h8" />
    </>
  ),
  review: (
    <>
      <rect x="6" y="3" width="13" height="16" rx="2" />
      <path d="M3 7v12a2 2 0 0 0 2 2h10" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  admin: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  classes: (
    <>
      <path d="M3 8.5 12 4l9 4.5-9 4.5z" />
      <path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5" />
      <path d="M21 8.5V14" />
    </>
  ),
  teach: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4M7 9h6M7 12h4" />
    </>
  ),
  worksheet: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 11h7M9 15h7" />
    </>
  ),
  hub: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  skills: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  spaced: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  errors: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="m9.5 10.5 5 5M14.5 10.5l-5 5" />
    </>
  ),
  scores: (
    <>
      <path d="M3 17l5-5 4 4 8-9" />
      <path d="M15 7h5v5" />
    </>
  ),
  messages: <path d="M4 5h16v11H9l-5 4z" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  mastery: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** Coursebook's mark (kept as Logo for existing imports). */
export function Logo({ className }: { className?: string }) {
  return <CoursebookMark className={className} />;
}

type NavLink = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; badgeLabel?: string };

/**
 * The links, short enough to fit without scrolling: the everyday pages at the
 * top, then folding sections (the one you're in opens by itself). Teaching
 * appears for people who teach; Settings and Admin live in the account menu.
 */
function NavLinks({ isStaff, dueCount, unread, onNavigate }: { isStaff: boolean; dueCount: number; unread: Props["unread"]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const top: NavLink[] = [
    { href: "/dashboard", label: "Today", icon: "home" },
    { href: "/messages", label: "Messages", icon: "messages", badge: unread.threads, badgeLabel: "unread conversations" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    { href: "/scores", label: "SAT scores", icon: "scores" },
  ];
  const groups: { label: string; links: NavLink[] }[] = [
    {
      label: "Learn",
      links: [
        { href: "/classes", label: "Classes", icon: "classes" },
        { href: "/library", label: "Library", icon: "library" },
        { href: "/slides", label: "Slides", icon: "slides" },
        { href: "/hub", label: "Hub", icon: "hub" },
      ],
    },
    {
      label: "Practice",
      links: [
        { href: "/skills", label: "Review", icon: "skills" },
        { href: "/review", label: "Flashcards", icon: "spaced", badge: dueCount, badgeLabel: "cards to review" },
        { href: "/mistakes", label: "Mistake log", icon: "errors" },
        { href: "/errors", label: "Error log", icon: "errors" },
        { href: "/mastery", label: "Mastery", icon: "mastery" },
      ],
    },
    ...(isStaff
      ? [
          {
            label: "Teaching",
            links: [
              { href: "/teach", label: "My classes", icon: "teach" as const },
              { href: "/teach/worksheets", label: "Worksheets", icon: "worksheet" as const },
              { href: "/teach/diagnostics", label: "Diagnostics", icon: "scores" as const },
              { href: "/teach/review", label: "Review queue", icon: "errors" as const },
            ],
          },
        ]
      : []),
  ];
  // The most specific link wins (e.g. /teach/worksheets, not /teach).
  const all = [...top, ...groups.flatMap((g) => g.links)];
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = all.map((l) => l.href).filter(matches).sort((x, y) => y.length - x.length)[0];
  const link = (l: NavLink) => {
    const active = l.href === activeHref;
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "press flex items-center gap-3 rounded-xl px-3 py-1.5 text-[0.93rem] transition-colors",
          active ? "bg-nav-active font-semibold text-nav-text shadow-[inset_3px_0_0_var(--accent)]" : "text-nav-text/85 hover:bg-nav-active/60 hover:text-nav-text",
        )}
      >
        <Icon name={l.icon} />
        <span className="flex-1">{l.label}</span>
        {l.badge ? (
          <span className="pop-in rounded-full bg-[#f4e4b0] px-2 text-xs font-bold leading-5 text-[#1b1f33]" aria-label={`${l.badge} ${l.badgeLabel ?? "new"}`}>
            {l.badge > 99 ? "99+" : l.badge}
          </span>
        ) : null}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">{top.map(link)}</div>
      {groups.map((g) => {
        const here = g.links.some((l) => l.href === activeHref);
        const count = g.links.reduce((n, l) => n + (l.badge ?? 0), 0);
        return (
          <details key={g.label} open={here} className="group/nav">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wider text-nav-muted hover:text-nav-text [&::-webkit-details-marker]:hidden">
              <span>
                {g.label}
                {count > 0 && <span className="ml-2 rounded-full bg-[#f4e4b0] px-1.5 text-[10px] text-[#1b1f33]">{count > 99 ? "99+" : count}</span>}
              </span>
              <svg viewBox="0 0 24 24" className="size-3.5 transition-transform group-open/nav:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </summary>
            <div className="mt-0.5 flex flex-col gap-0.5">{g.links.map(link)}</div>
          </details>
        );
      })}
    </nav>
  );
}

/** The notification bell, with a gold dot and count when something's new. */
function Bell({ count, onNavigate }: { count: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <Link
      href="/notifications"
      onClick={onNavigate}
      aria-current={pathname === "/notifications" ? "page" : undefined}
      className="relative inline-flex size-9 items-center justify-center rounded-xl text-nav-text hover:bg-nav-active"
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
    >
      <Icon name="bell" />
      {count > 0 && <span className="pop-in absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-accent-text">{count > 9 ? "9+" : count}</span>}
    </Link>
  );
}

function Stats({ game }: { game: Props["game"] }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-nav-active px-2.5 py-1 font-semibold text-nav-text" title="Study streak">
        <span aria-hidden>{game.streak > 0 ? "🔥" : "🌙"}</span>
        {game.streak}
        <span className="sr-only"> day streak</span>
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-nav-active px-2.5 py-1 font-semibold text-nav-text" title={`Level ${game.level}`}>
        <span aria-hidden className="text-[#f4e4b0]">✦</span>
        {game.xp.toLocaleString("en-US")} <span className="text-xs font-medium text-nav-muted">XP</span>
      </span>
    </div>
  );
}

export function AppSidebar({ user, dueCount, timeZone, game, unread }: Props) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);

  // "Today" is the student's day: save the browser's time zone once.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && timeZone && tz !== timeZone) void setTimeZoneAction(tz);
  }, [timeZone]);

  // Close the phone menu after navigating.
  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <Wordmark />
    </Link>
  );

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside className="dark-nav fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-5 overflow-y-auto bg-nav px-3 py-5 lg:flex">
        <div className="flex items-center justify-between gap-2 px-1">
          {brand}
          <Bell count={unread.notices} />
        </div>
        <div className="px-1">
          <Stats game={game} />
        </div>
        <NavLinks isStaff={user.isStaff} dueCount={dueCount} unread={unread} />
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-4">
          <UserMenu name={user.name} email={user.email} isAdmin={user.isAdmin} placement="up" showName />
          <ThemeToggle className="text-nav-muted hover:bg-nav-active hover:text-nav-text" />
        </div>
      </aside>

      {/* Phones and tablets: top bar + slide-out menu */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 bg-nav px-4 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <CoursebookMark className="size-8" />
          <span className="font-display text-lg font-semibold text-nav-text">{BRAND.name}</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden min-[400px]:block">
            <Stats game={game} />
          </span>
          <Link href="/notifications" className="relative inline-flex size-10 items-center justify-center rounded-xl text-nav-text hover:bg-nav-active" aria-label={unread.notices ? `Notifications, ${unread.notices} unread` : "Notifications"}>
            <Icon name="bell" />
            {unread.notices > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-accent ring-2 ring-nav" />}
          </Link>
          <button
            type="button"
            onClick={() => drawer.current?.showModal()}
            className="inline-flex size-10 items-center justify-center rounded-xl text-nav-text hover:bg-nav-active"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </header>
      <dialog
        ref={drawer}
        aria-label="Menu"
        className="drawer m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-nav p-0 text-nav-text backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === drawer.current) drawer.current?.close(); // tap outside
        }}
      >
        <div className="flex h-full flex-col gap-6 px-4 py-5">
          <div className="flex items-center justify-between">
            {brand}
            <button type="button" onClick={() => drawer.current?.close()} className="inline-flex size-9 items-center justify-center rounded-xl text-nav-text hover:bg-nav-active" aria-label="Close menu">
              ✕
            </button>
          </div>
          <Stats game={game} />
          <NavLinks isStaff={user.isStaff} dueCount={dueCount} unread={unread} onNavigate={() => drawer.current?.close()} />
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-4">
            <UserMenu name={user.name} email={user.email} isAdmin={user.isAdmin} placement="up" showName />
            <ThemeToggle className="text-nav-muted hover:bg-nav-active hover:text-nav-text" />
          </div>
        </div>
      </dialog>
    </>
  );
}
