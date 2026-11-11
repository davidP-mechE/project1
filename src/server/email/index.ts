import "server-only";
import nodemailer from "nodemailer";
import { env } from "../env";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 15_000;

const smtp = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    })
  : null;

/** How email is sent on this server, for the admin page. Never includes secrets. */
export function emailStatus() {
  const provider = env.RESEND_API_KEY ? "resend" : smtp ? "smtp" : "console";
  return {
    provider,
    detail: provider === "resend" ? "Resend HTTP API" : provider === "smtp" ? `SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}${env.SMTP_SECURE ? " (TLS)" : ""}` : "Not set up: emails are only printed to the server log",
    from: env.EMAIL_FROM,
    canSend: provider !== "console",
  } as const;
}

async function sendWithResend(message: EmailMessage) {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Resend explains what's wrong (an unverified sender domain, a bad key...): pass that on.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Resend refused the email (${res.status}): ${body?.message ?? res.statusText}`);
  }
}

/**
 * Sends an email: through Resend's HTTP API when RESEND_API_KEY is set, else
 * over SMTP (Mailpit in dev, Resend or any SMTP server in production). With
 * neither, the email is printed to the server console so links (verify, reset
 * password) can still be followed during development; in production that's an
 * error, so a missing setup is never silent.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.RESEND_API_KEY) return sendWithResend(message);
  if (!smtp) {
    if (env.NODE_ENV === "production") {
      throw new Error("Email isn't set up: set RESEND_API_KEY, or SMTP_HOST and the other SMTP settings.");
    }
    console.info(
      `\n──── EMAIL (not sent: no RESEND_API_KEY or SMTP_HOST) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n──────────────────────────────────────────────\n`,
    );
    return;
  }
  await smtp.sendMail({ from: env.EMAIL_FROM, ...message });
}
