import type { Metadata } from "next";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Two-factor code" };

/** The second login step for accounts with two-factor login on. */
export default async function TwoFactorPage({ searchParams }: PageProps<"/login/two-factor">) {
  const { next } = await searchParams;
  return <TwoFactorForm next={safeNext(next)} />;
}
