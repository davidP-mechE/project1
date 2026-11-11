import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { Wordmark } from "@/components/brand/seal";

/** Sign-in, sign-up and account recovery: the form, beside a Coursebook cover on wider screens. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/">
          <Wordmark onDark={false} />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto grid w-full max-w-5xl flex-1 items-start gap-10 px-4 py-8 sm:py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:items-center">
        <div aria-hidden className="hero-card hidden min-h-[28rem] flex-col justify-end gap-4 rounded-lg pb-14 pl-16 pr-8 pt-10 md:flex">
          <p className="text-sm font-semibold text-white/85">Coursebook</p>
          <p className="cover-title text-[2.9rem]">Your textbooks and slides, as courses.</p>
          <p className="max-w-sm text-white/85">Lessons, practice, flashcards and a tutor, made from the books you already have.</p>
        </div>
        <div className="w-full rounded-lg border-[1.5px] border-border bg-surface p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
