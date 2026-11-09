import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/server/session";

const features = [
  { title: "Upload your textbook", body: "Any PDF up to 1,000 pages. Scanned books work too." },
  { title: "Get a real course", body: "Units, lessons, worked examples, key terms and practice questions, all with page references." },
  { title: "Study smarter", body: "Flashcards with spaced repetition, an 'Ask the book' tutor, and a study plan that fits your schedule." },
];

export default async function Home() {
  if (await getSession()) redirect("/library");
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Turn any textbook into a self-paced course.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        Coursebook reads your textbook PDF and builds lessons, practice questions and flashcards that stay true to the
        book, so you can study on your own with structure.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/signup">Get started free</ButtonLink>
        <ButtonLink href="/login" variant="secondary">I have an account</ButtonLink>
      </div>
      <ul className="mt-16 grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <li key={f.title} className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
