import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, LegalPage, legalName } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

// A plain-language starting point, not legal advice. Have it reviewed for your
// country before you open the site to the public (see DEPLOY.md).
export default function TermsPage() {
  const who = legalName();
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms are the agreement between you and {who} (“we”, “us”) for using Coursebook, a service that turns a textbook you upload into a
          private, self-paced course. By creating an account you agree to them. If you don’t agree, please don’t use the service.
        </p>
      }
      sections={[
        {
          id: "account",
          title: "Your account",
          body: (
            <ul>
              <li>You must be at least 13 years old, or the minimum age to use online services without a parent’s consent where you live.</li>
              <li>Give a real email address and keep your password to yourself. You’re responsible for what happens in your account.</li>
              <li>Tell us at <ContactEmail /> if you think someone else has got into your account.</li>
            </ul>
          ),
        },
        {
          id: "uploads",
          title: "The books you upload",
          body: (
            <>
              <p>
                Only upload material you own or have the right to use, for example a textbook you bought for your own study, course material your
                teacher gave you, or an openly licensed book. You confirm this each time you upload.
              </p>
              <ul>
                <li>Your books and the courses made from them are private to your account. We never show them to other users or publish them.</li>
                <li>
                  You keep all rights in what you upload. You give us permission to store and process it only as needed to run the service for you:
                  reading the text, sending parts of it to our AI provider to write your lessons, and showing it back to you.
                </li>
                <li>Don’t upload anything illegal, malicious (such as files designed to attack our systems), or other people’s personal data.</li>
              </ul>
            </>
          ),
        },
        {
          id: "ai",
          title: "AI-written content",
          body: (
            <>
              <p>
                Lessons, questions, flashcards, tests, grades and tutor answers are written by an AI model (Anthropic’s Claude) from your book. They
                are designed to stick to the book and cite its pages, but they <strong>can contain mistakes</strong>. Check anything important
                against the original pages, which are always one click away.
              </p>
              <p>Coursebook is a study aid. It doesn’t replace your teacher, your course’s official materials, or professional advice.</p>
            </>
          ),
        },
        {
          id: "fair-use",
          title: "Fair use and limits",
          body: (
            <>
              <p>
                Writing lessons and grading answers costs real money per use, so each plan has monthly allowances (AI usage, pages turned into
                lessons, books and storage) and some hourly limits. You can see your usage under Settings → Plan and usage. When an allowance runs
                out, the features that need it pause until it resets at the start of the next month.
              </p>
              <p>Please don’t:</p>
              <ul>
                <li>try to get around the limits, for example with several accounts;</li>
                <li>use automated tools to scrape or overload the service;</li>
                <li>try to access other people’s data or probe our security (if you find a problem, please tell us instead);</li>
                <li>use the service to break the law or anyone’s rights.</li>
              </ul>
            </>
          ),
        },
        {
          id: "copyright",
          title: "Copyright complaints",
          body: (
            <p>
              We respond to copyright complaints as described on our <Link href="/copyright">copyright page</Link>. We may remove content that is
              reported, and we close the accounts of people who repeatedly upload material they don’t have the right to use.
            </p>
          ),
        },
        {
          id: "ending",
          title: "Ending your use",
          body: (
            <p>
              You can delete your account at any time in Settings. That permanently deletes your books, courses and study history (see the{" "}
              <Link href="/privacy">privacy policy</Link>). We may suspend or close an account that breaks these terms, after warning you where
              that’s reasonable. We may also change or stop the service; if we stop it, we’ll give you notice so you can download your notes and
              courses first (Export, in each course).
            </p>
          ),
        },
        {
          id: "liability",
          title: "Warranties and liability",
          body: (
            <>
              <p>
                We work hard to keep Coursebook running and accurate, but the service is provided “as is”, without guarantees that it will always be
                available, error-free, or that it will get you a particular result in a course or exam.
              </p>
              <p>
                As far as the law allows, we aren’t liable for indirect or consequential losses, and our total liability to you is limited to the
                amount you paid us in the 12 months before the claim (or €50 / $50 if you use a free plan). Nothing in these terms limits rights you
                have under consumer law that can’t be limited.
              </p>
            </>
          ),
        },
        {
          id: "changes",
          title: "Changes to these terms",
          body: <p>If we make important changes, we’ll tell you by email or in the app before they take effect. The date at the top shows the latest version.</p>,
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <p>
              Questions about these terms: <ContactEmail />.
            </p>
          ),
        },
      ]}
    />
  );
}
