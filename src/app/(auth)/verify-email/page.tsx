import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { email, error } = await searchParams;
  return <VerifyEmail email={typeof email === "string" ? email : undefined} expired={typeof error === "string"} />;
}
