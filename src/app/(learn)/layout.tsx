import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Wordmark } from "@/components/brand/seal";
import { getSession } from "@/server/session";

/**
 * The course catalog's layout. It never redirects: each page first checks the
 * course is one this visitor may see (drafts are a plain 404 for everyone but
 * the owner, signed in or not), and only then asks a signed-out visitor to log in.
 */
export default async function LearnLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (session) {
    const { id, name, email, image } = session.user;
    return <AppShell user={{ id, name, email, image, role: (session.user as { role?: string }).role ?? "USER" }}>{children}</AppShell>;
  }
  return (
    <>
      <header className="border-b border-border bg-nav">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {children}
      </main>
    </>
  );
}
