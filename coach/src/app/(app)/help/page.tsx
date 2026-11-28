"use client";
import { useMe } from "@/components/use-me";
import { CrisisResources } from "@/components/crisis-resources";

export default function HelpPage() {
  const { me } = useMe();
  return (
    <main className="wrap page">
      <h1>Talk to a person now</h1>
      <p className="lede">If you might hurt yourself or someone else, or you&apos;re not safe where you are, please reach out to one of these. They&apos;re free and confidential. This app is an AI and can&apos;t help in an emergency the way a person can.</p>
      {me && <CrisisResources resources={me.resources} />}
      <p className="muted small">Outside these countries, contact your local emergency number. Change your country in Privacy &amp; settings.</p>
    </main>
  );
}
