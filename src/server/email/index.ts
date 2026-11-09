import "server-only";
import nodemailer from "nodemailer";
import { env } from "../env";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    })
  : null;

/**
 * Sends an email over SMTP (Mailpit in dev, Resend/any SMTP in production).
 * With no SMTP_HOST configured, the email is printed to the server console so
 * links (verify, reset password) can still be followed during development.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!transport) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP_HOST is not configured; cannot send email in production.");
    }
    console.info(
      `\n──── EMAIL (not sent: SMTP_HOST is empty) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n──────────────────────────────────────────────\n`,
    );
    return;
  }
  await transport.sendMail({ from: env.EMAIL_FROM, ...message });
}
