import Link from "next/link";
import { ReportProblemButton } from "@/components/support/report-problem";
import { BRAND } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border px-4 py-6 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p>
          © {new Date().getFullYear()} {BRAND.name}
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <Link href="/help" className="hover:text-text">Help</Link>
          <Link href="/terms" className="hover:text-text">Terms</Link>
          <Link href="/privacy" className="hover:text-text">Privacy</Link>
          <Link href="/copyright" className="hover:text-text">Copyright</Link>
          <ReportProblemButton className="hover:text-text hover:underline" />
        </nav>
      </div>
    </footer>
  );
}
