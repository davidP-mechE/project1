import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/brand";
import { WaitlistForm } from "@/components/waitlist-form";

export default function Landing() {
  return (
    <>
      <header className="bar">
        <div className="bar-inner">
          <span className="wordmark">{PRODUCT_NAME}</span>
          <span style={{ flex: 1 }} />
          <Link href="/talk" className="small">Try it</Link>
        </div>
      </header>
      <main className="wrap">
        <section className="hero">
          <h1>Work out what you felt, why, and what keeps repeating.</h1>
          <p className="lede">Talk or type about what happened. {PRODUCT_NAME} asks the questions a good coach would, tests more than one explanation, and only keeps what you confirm.</p>
        </section>

        <section className="sample" aria-label="An example conversation">
          <div className="you"><span>I&apos;m irritated with my friend and I don&apos;t know why.</span></div>
          <div className="coach"><p>Let&apos;s find out. What&apos;s the most recent thing that happened with her?</p></div>
          <div className="you"><span>She made weekend plans with the group and didn&apos;t invite me. I saw it on Instagram. Honestly I don&apos;t even care about the plan.</span></div>
          <div className="coach"><p>Then it might be less about the weekend and more that you needed to feel considered, and seeing it online told you that you weren&apos;t. That would explain the embarrassment too. Does that fit?</p></div>
        </section>

        <h2>Every insight shows its evidence</h2>
        <p>Most chatbots reply to whatever you just said. This one investigates: it names the feelings, holds two or three possible reasons, asks the question that tells them apart, and puts its best guess to you. You can always say &ldquo;that&apos;s not it.&rdquo;</p>
        <p>Over weeks, it connects episodes that happened far apart, but a pattern only appears when your own confirmed sessions back it up.</p>

        <h2>What it isn&apos;t</h2>
        <ul className="nots">
          <li>Not therapy, treatment or a medical device. It never diagnoses.</li>
          <li>Not a companion or a digital friend. It&apos;s a tool you use and leave.</li>
          <li>Not a crisis service. If you&apos;re in danger, it stops and connects you to people who can help.</li>
        </ul>

        <h2>Get early access</h2>
        <p>For adults 18 and over. We&apos;ll email you when it opens. Nothing else.</p>
        <WaitlistForm />
      </main>
      <footer className="site">
        <div className="wrap">
          In the US, if you&apos;re thinking about suicide or are worried about someone, call or text <a href="tel:988">988</a>. In an emergency, call 911.
        </div>
      </footer>
    </>
  );
}
