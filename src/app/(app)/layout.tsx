import { AppSidebar } from "@/components/app-sidebar";
import { PageTransition } from "@/components/page-transition";
import { SiteFooter } from "@/components/site-footer";
import { ErrorCapture } from "@/components/support/report-problem";
import { requireUser } from "@/server/session";
import { isStaging } from "@/server/env";
import { db } from "@/server/db";
import { getReviewCounts } from "@/server/srs";
import { getGameSummary } from "@/server/gamification";
import { unreadCount } from "@/server/notifications";
import { unreadThreadCount } from "@/server/messages";
import { staffClassIds } from "@/server/access";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [counts, prefs, game, notices, threads] = await Promise.all([
    getReviewCounts(user.id),
    db.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
    getGameSummary(user.id),
    unreadCount(user.id),
    unreadThreadCount(user.id),
  ]);
  const isStaff = (await staffClassIds(user.id)).length > 0;
  return (
    <>
      <AppSidebar
        user={{ name: user.name, email: user.email, isAdmin: user.role === "ADMIN", isStaff }}
        dueCount={counts.due + counts.new}
        timeZone={prefs?.timezone ?? "UTC"}
        game={{ streak: game.streak, xp: game.xp, level: game.level }}
        unread={{ notices, threads }}
      />
      <ErrorCapture />
      {isStaging && (
        <div role="note" className="fixed inset-x-0 top-0 z-50 bg-warning px-3 py-1 text-center text-xs font-semibold text-white dark:text-bg">
          Staging copy: fake data only. Changes here don&apos;t affect the real site.
        </div>
      )}
      <div className="paper flex min-h-dvh flex-col pb-16 lg:pb-0">
        <main id="main" className="mx-auto w-full min-w-0 max-w-[92rem] flex-1 px-4 py-8 sm:px-6 lg:px-12">
          <PageTransition>{children}</PageTransition>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
