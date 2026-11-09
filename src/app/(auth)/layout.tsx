import Link from "next/link";
import { ThemeToggle } from "@/components/theme";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">Coursebook</Link>
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">{children}</div>
      </main>
    </div>
  );
}
