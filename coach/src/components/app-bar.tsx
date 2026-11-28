"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRODUCT_NAME } from "@/lib/brand";

const LINKS = [
  { href: "/talk", label: "Talk" },
  { href: "/patterns", label: "My patterns" },
  { href: "/history", label: "History" },
  { href: "/progress", label: "Progress" },
  { href: "/settings", label: "Privacy & settings" },
];

/** Crisis resources are always one tap away (spec: "Privacy & settings" + safety). */
export function AppBar() {
  const path = usePathname();
  return (
    <header className="bar">
      <div className="bar-inner">
        <Link href="/talk" className="wordmark">{PRODUCT_NAME}</Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>{l.label}</Link>
          ))}
        </nav>
        <Link href="/help" className="help-link">Get help now</Link>
      </div>
    </header>
  );
}
