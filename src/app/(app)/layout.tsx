import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { PageTransition } from "@/components/page-transition";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme";
import { UserMenu } from "@/components/user-menu";
import { requireUser } from "@/server/session";
import { db } from "@/server/db";
import { getReviewCounts } from "@/server/srs";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [counts, prefs] = await Promise.all([
    getReviewCounts(user.id),
    db.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
  ]);
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <Link href="/dashboard" className="font-semibold tracking-tight" aria-label="Coursebook home">
              <span className="hidden sm:inline">Coursebook</span>
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-text sm:hidden" aria-hidden>
                C
              </span>
            </Link>
            <AppNav dueCount={counts.due + counts.new} timeZone={prefs?.timezone ?? "UTC"} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} isAdmin={user.role === "ADMIN"} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
