import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { SiteFooter } from "@/components/site-footer";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/app-sidebar";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Coursebook home">
            <Logo />
            <span className="font-display text-xl font-semibold tracking-tight">Coursebook</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonLink href="/login" variant="ghost" size="sm">Log in</ButtonLink>
            <ButtonLink href="/signup" size="sm">Sign up</ButtonLink>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
