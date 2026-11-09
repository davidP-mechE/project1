import { AppSidebar } from "@/components/app-sidebar";
import { PageTransition } from "@/components/page-transition";
import { SiteFooter } from "@/components/site-footer";
import { requireUser } from "@/server/session";
import { db } from "@/server/db";
import { getReviewCounts } from "@/server/srs";
import { getGameSummary } from "@/server/gamification";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [counts, prefs, game] = await Promise.all([
    getReviewCounts(user.id),
    db.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
    getGameSummary(user.id),
  ]);
  return (
    <>
      <AppSidebar
        user={{ name: user.name, email: user.email, isAdmin: user.role === "ADMIN" }}
        dueCount={counts.due + counts.new}
        timeZone={prefs?.timezone ?? "UTC"}
        game={{ streak: game.streak, xp: game.xp, level: game.level }}
      />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <PageTransition>{children}</PageTransition>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
