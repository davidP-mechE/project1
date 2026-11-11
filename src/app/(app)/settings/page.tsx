import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/account-settings";
import { StudyPreferences } from "@/components/settings/study-preferences";
import { UsageMeter } from "@/components/settings/usage-meter";
import { getUsage } from "@/server/limits";
import { getPreferences } from "@/server/preferences";
import { PageHeader } from "@/components/ui/misc";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";
import { TwoFactorSettings } from "@/components/settings/two-factor-settings";
import { needsStaffTwoFactor, staffClassIds } from "@/server/access";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { getNotificationPrefs } from "@/server/notifications";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const { notice } = await searchParams;
  const [prefs, credential, usage] = await Promise.all([
    getPreferences(user.id),
    db.account.findFirst({ where: { userId: user.id, providerId: "credential" }, select: { id: true } }),
    getUsage(user.id),
  ]);
  const [me, staffRequired, notices, staffClasses] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorEnabled: true } }),
    needsStaffTwoFactor(user.id),
    getNotificationPrefs(user.id),
    staffClassIds(user.id),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description="Your profile, study preferences, notifications and account." />
      <TwoFactorSettings enabled={Boolean(me.twoFactorEnabled)} required={staffRequired || notice === "two-factor"} hasPassword={Boolean(credential)} />
      <div className="mb-6">
        <StudyPreferences initial={prefs} zones={Intl.supportedValuesOf("timeZone")} />
      </div>
      <div className="mb-6">
        <NotificationSettings initial={notices} isStaff={staffClasses.length > 0} />
      </div>
      <div className="mb-6">
        <UsageMeter {...usage} />
      </div>
      <AccountSettings
        name={user.name}
        email={user.email}
        hasPassword={Boolean(credential)}
        notice={
          notice === "email-verified"
            ? "Thanks, that link worked. If you just approved an email change, check your new inbox for one last verification link. Your current address is shown below."
            : undefined
        }
      />
    </div>
  );
}
