import type { Metadata } from "next";
import { ContactEmail, LegalPage, legalName } from "@/components/legal/legal-page";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Copyright & Takedown" };

// A plain-language starting point, not legal advice. In the US, register a
// designated agent with the Copyright Office to rely on the DMCA safe harbor.
export default function CopyrightPage() {
  const who = legalName();
  return (
    <LegalPage
      title="Copyright & Takedown"
      intro={
        <p>
          Coursebook lets people study textbooks they have the right to use. Uploads are private: a book and the course made from it can only be
          seen by the account that uploaded it, and nothing is published or shared with other users. Even so, we take copyright seriously and
          respond to valid complaints quickly.
        </p>
      }
      sections={[
        {
          id: "policy",
          title: "Our policy",
          body: (
            <ul>
              <li>Everyone who uploads a book confirms they own it or have the right to use it.</li>
              <li>When we receive a valid notice, we remove or disable the material and tell the account holder.</li>
              <li>We close the accounts of repeat infringers.</li>
            </ul>
          ),
        },
        {
          id: "notice",
          title: "How to send a notice",
          body: (
            <>
              <p>Send your notice to our designated copyright agent:</p>
              <p className="whitespace-pre-line rounded-lg border border-border bg-surface p-4">
                {env.COPYRIGHT_AGENT ? env.COPYRIGHT_AGENT.replace(/\\n/g, "\n") : `Copyright agent, ${who}`}
                {"\n"}Email: <ContactEmail />
              </p>
              <p>Please include:</p>
              <ul>
                <li>your physical or electronic signature;</li>
                <li>the copyrighted work you believe is infringed;</li>
                <li>
                  where the material is, as precisely as you can (because courses are private, details such as the book’s title, edition and the
                  account you believe uploaded it help us find it);
                </li>
                <li>your name, postal address, phone number and email;</li>
                <li>a statement that you believe in good faith that the use isn’t authorized by the copyright owner, its agent, or the law;</li>
                <li>a statement that the information in your notice is accurate and, under penalty of perjury, that you are the owner or authorized to act for the owner.</li>
              </ul>
            </>
          ),
        },
        {
          id: "counter",
          title: "If your upload was removed",
          body: (
            <p>
              If you think material was removed by mistake, or that you have the right to use it, you can send a counter-notice to the same address
              with: your signature; what was removed; a statement under penalty of perjury that you believe it was removed by mistake; your name,
              address and phone number; and your consent to the jurisdiction of the courts where you live (or, outside the US, where we are based).
              We’ll forward it to the person who complained, and may restore the material after 10 business days unless they tell us they’ve gone
              to court.
            </p>
          ),
        },
        {
          id: "misuse",
          title: "False claims",
          body: <p>Knowingly false notices or counter-notices can make the sender liable for damages. If you aren’t sure the material infringes, consider getting advice first.</p>,
        },
      ]}
    />
  );
}
