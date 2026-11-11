import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { SiteFooter } from "@/components/site-footer";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/seal";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="dark-nav bg-nav">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/">
            <Wordmark />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1 sm:gap-2">
            <Link href="/help" className="hidden rounded-md px-3 py-1.5 text-sm font-semibold text-nav-text hover:bg-nav-active sm:inline-flex">
              Help
            </Link>
            <ThemeToggle className="text-nav-muted hover:bg-nav-active hover:text-nav-text" />
            <Link href="/login" className="rounded-md px-3 py-1.5 text-sm font-semibold text-nav-text hover:bg-nav-active">
              Log in
            </Link>
            <ButtonLink href="/signup" size="sm" variant="accent">
              Sign up
            </ButtonLink>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
