import type { Metadata } from "next";
import { ContactEmail, LegalPage, legalName } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

// A plain-language starting point, not legal advice. It describes what this
// code actually does; update it if you add services (analytics, payments, …).
export default function PrivacyPage() {
  const who = legalName();
  return (
    <LegalPage
      title="Privacy Policy"
      draft={[
        "Who runs Coursebook and who to contact (name, email, address)",
        "For each tutoring program: who runs it, and whether its school needs a data agreement (FERPA) and parental consent for students under 18",
        "Confirmation that every student is 13 or older (COPPA)",
        "How long data is kept after a student leaves",
        "Tutoring-program data: scores, answers, attendance, messages, guardian contacts, and what's sent to Claude (Anthropic)",
      ]}
      intro={
        <p>
          This explains what {who} (“we”) collects when you use Coursebook, why, who else handles it, and how to delete it. Short version: we keep
          what’s needed to run your courses, your books stay private, there are no ads or third-party trackers, and deleting your account deletes
          your data.
        </p>
      }
      sections={[
        {
          id: "collect",
          title: "What we collect",
          body: (
            <ul>
              <li>
                <strong>Account:</strong> your name, email address and a scrambled (hashed) version of your password. If you sign in with Google, we
                receive your name, email and profile picture from Google.
              </li>
              <li>
                <strong>Your books:</strong> the PDF files you upload, the text and images we read from them, and the courses made from them (outline,
                lessons, questions, flashcards, tests).
              </li>
              <li>
                <strong>Your studying:</strong> progress, answers and grades, flashcard reviews, highlights, notes, tutor conversations, study plans,
                minutes studied and your study preferences (daily goal, time zone, reminders).
              </li>
              <li>
                <strong>Usage records:</strong> for each AI request, which feature it was for, how many tokens it used and what it cost (to enforce
                plan limits). We also count a few actions, such as downloads and searches, to see which features are used.
              </li>
              <li>
                <strong>Technical data:</strong> your IP address and browser, used to keep you logged in, limit abuse (for example too many login
                attempts) and in short-lived server logs.
              </li>
            </ul>
          ),
        },
        {
          id: "use",
          title: "How we use it",
          body: (
            <>
              <p>Only to provide the service you asked for: reading your books, writing and showing your courses, grading answers, reminders you turned on, account emails (verification, password reset), enforcing limits, keeping the service secure, and fixing problems.</p>
              <p>We don’t sell your data, show ads, or use your books or study data to train AI models.</p>
            </>
          ),
        },
        {
          id: "programs",
          title: "If you join a tutoring program",
          body: (
            <>
              <p>A tutoring program (for example, a school&apos;s SAT program) runs its classes on Coursebook. Inside it, your tutors see your work for their classes (some only for their subject or group), and your program admin sees the whole program.</p>
              <p>Messages between students and tutors can be read by your program admin, to keep everyone safe. Other students never see your scores or messages.</p>
              <p>Each program&apos;s data is its own: it isn&apos;t shared with other programs.</p>
            </>
          ),
        },
        {
          id: "processors",
          title: "Who else handles your data",
          body: (
            <>
              <p>We use a few providers to run the service. They process data only on our instructions:</p>
              <ul>
                <li>
                  <strong>Anthropic (Claude API)</strong> receives the parts of your book needed for each task (a lesson’s pages, a question’s cited
                  pages, the passages relevant to a tutor question), plus your written answers and tutor questions. Under Anthropic’s commercial terms,
                  API data isn’t used to train their models and is kept only for a limited time for safety monitoring.
                </li>
                <li>
                  <strong>Hosting, database and file storage</strong> providers store your account, courses and uploaded PDFs.
                </li>
                <li>
                  <strong>An email provider</strong> sends account emails and the reminders you turn on.
                </li>
                <li>
                  <strong>Google</strong>, only if you choose “Continue with Google”.
                </li>
              </ul>
              <p>
                The “Ask the book” search index (embeddings) is computed on our own server; your book isn’t sent anywhere else for it. Your data may
                be processed in countries other than your own; we use providers that offer appropriate safeguards for this.
              </p>
            </>
          ),
        },
        {
          id: "cookies",
          title: "Cookies and local storage",
          body: (
            <p>
              We use one essential cookie to keep you logged in. Your browser also stores a few preferences on your device (light or dark theme,
              unsent test answers so a reload doesn’t lose them). There are no advertising or analytics cookies, so there’s no cookie banner.
            </p>
          ),
        },
        {
          id: "retention",
          title: "How long we keep it",
          body: (
            <ul>
              <li>Your account, books, courses and study data: until you delete them or your account.</li>
              <li>Uploads that never finished: removed automatically after a day.</li>
              <li>
                When you delete your account, your books, files, courses and study data are deleted at once. Cost records and feature counts are kept
                without anything that identifies you, for our accounting.
              </li>
              <li>Server logs and backups roll over and are deleted within about 30 days.</li>
            </ul>
          ),
        },
        {
          id: "rights",
          title: "Your choices and rights",
          body: (
            <>
              <ul>
                <li>
                  <strong>See and take your data:</strong> each course can be downloaded (Export: Markdown, PDF, CSV, Anki), and your notes and
                  highlights can be exported too.
                </li>
                <li>
                  <strong>Correct it:</strong> change your name, email and password in Settings, and edit lessons and notes yourself.
                </li>
                <li>
                  <strong>Delete it:</strong> delete a course from your library, or your whole account in Settings.
                </li>
                <li>
                  <strong>Reminders:</strong> off by default; every reminder email has a one-click link to turn them off.
                </li>
              </ul>
              <p>
                Depending on where you live (for example under the GDPR or CCPA), you may have further rights, such as asking for a copy of all your
                data or objecting to how it’s used, and you can complain to your data protection authority. To use any of these rights, email{" "}
                <ContactEmail />.
              </p>
            </>
          ),
        },
        {
          id: "security",
          title: "Security",
          body: (
            <p>
              Passwords are hashed, connections are encrypted (HTTPS), every request is checked so you can only reach your own data, and uploaded
              files are only available through short-lived links. No system is perfectly secure; if we learn of a breach affecting you, we’ll tell
              you as the law requires.
            </p>
          ),
        },
        {
          id: "children",
          title: "Children",
          body: <p>Coursebook isn’t meant for children under 13 (or the minimum age in your country). If you think a child has given us data, contact us and we’ll delete it.</p>,
        },
        {
          id: "changes",
          title: "Changes and contact",
          body: (
            <p>
              We’ll tell you about important changes by email or in the app. Questions, or to use your rights: <ContactEmail />.
            </p>
          ),
        },
      ]}
    />
  );
}
