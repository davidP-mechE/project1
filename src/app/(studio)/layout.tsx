import { AppShell } from "@/components/app-shell";
import { requireOwner } from "@/server/owner-guard";

/**
 * The Course Studio: the owner only. Everyone else (signed out, students,
 * tutors, site admins) gets the site's plain 404 before anything renders, so
 * nobody can tell it exists.
 */
export default async function StudioLayout({ children }: LayoutProps<"/">) {
  const owner = await requireOwner();
  return <AppShell user={{ id: owner.id, name: owner.name, email: owner.email, role: owner.role }}>{children}</AppShell>;
}
