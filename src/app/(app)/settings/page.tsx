import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/account-settings";
import { StudyPreferences } from "@/components/settings/study-preferences";
import { UsageMeter } from "@/components/settings/usage-meter";
import { getUsage } from "@/server/limits";
import { getPreferences } from "@/server/preferences";
import { PageHeader } from "@/components/ui/misc";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const { notice } = await searchParams;
  const [prefs, credential, usage] = await Promise.all([
    getPreferences(user.id),
    db.account.findFirst({ where: { userId: user.id, providerId: "credential" }, select: { id: true } }),
    getUsage(user.id),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description="Your study preferences and account." />
      <div className="mb-6">
        <StudyPreferences initial={prefs} zones={Intl.supportedValuesOf("timeZone")} />
      </div>
      <div className="mb-6">
        <UsageMeter {...usage} />
      </div>
      <AccountSettings
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
