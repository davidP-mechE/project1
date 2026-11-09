import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border px-4 py-6 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p>© {new Date().getFullYear()} Coursebook</p>
        <nav aria-label="Legal" className="flex gap-4">
          <Link href="/terms" className="hover:text-text">Terms</Link>
          <Link href="/privacy" className="hover:text-text">Privacy</Link>
          <Link href="/copyright" className="hover:text-text">Copyright</Link>
        </nav>
      </div>
    </footer>
  );
}
