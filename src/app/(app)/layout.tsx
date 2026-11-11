import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
