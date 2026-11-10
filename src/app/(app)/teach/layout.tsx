import { redirect } from "next/navigation";
import { needsStaffTwoFactor } from "@/server/access";
import { requireUser } from "@/server/session";

/** Program staff must turn on two-factor login before any teaching page (the server functions check it too). */
export default async function TeachLayout({ children }: LayoutProps<"/teach">) {
  const user = await requireUser();
  if (await needsStaffTwoFactor(user.id)) redirect("/settings?notice=two-factor#two-factor");
  return children;
}
