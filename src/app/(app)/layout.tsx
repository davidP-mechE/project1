import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme";
import { UserMenu } from "@/components/user-menu";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <div className="flex items-center gap-4">
            <Link href="/library" className="font-semibold tracking-tight">Coursebook</Link>
            <AppNav />
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <SiteFooter />
    </>
  );
}
