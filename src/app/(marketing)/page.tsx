import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/server/session";

const features = [
  { icon: "📖", title: "Textbooks", body: "Upload a PDF up to 1,000 pages (scanned books work too) and get units, lessons, worked examples and key terms, all with page references." },
  { icon: "🖥️", title: "Lecture slides", body: "Upload a deck from class as PDF or PowerPoint. Each lesson explains the bullet points, using the speaker notes and diagrams too." },
  { icon: "🌙", title: "Practice until it sticks", body: "Mastery practice sets, flashcards with spaced repetition, an 'Ask the book' tutor, daily quests and a study plan." },
];

export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <section className="hero-card flex flex-col gap-6 rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16">
        <h1 className="max-w-3xl text-4xl font-semibold sm:text-6xl">Turn your textbooks and slides into a course you’ll actually finish.</h1>
        <p className="max-w-2xl text-lg opacity-90">
          Coursebook reads your textbook or lecture slides and builds short lessons, practice and flashcards that stay true to the source, so you
          can study on your own, with structure.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/signup" className="hero-button">
            Get started free
          </ButtonLink>
          <ButtonLink href="/login" variant="ghost" className="hero-ghost">
            I have an account
          </ButtonLink>
        </div>
      </section>
      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <li key={f.title} className="lift rounded-2xl border border-border bg-surface p-6">
            <span aria-hidden className="text-2xl">
              {f.icon}
            </span>
            <h2 className="mt-3 text-xl font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
