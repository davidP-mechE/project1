import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/theme";
import "katex/dist/katex.min.css";
import "@fontsource-variable/nunito";
import "@fontsource-variable/fraunces/soft.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Coursebook", template: "%s · Coursebook" },
  description: "Turn a textbook PDF into a structured, self-paced course.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6efe0" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1220" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by src/proxy.ts; the theme script needs it to pass the Content-Security-Policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: next-themes adds the theme class before React loads.
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
