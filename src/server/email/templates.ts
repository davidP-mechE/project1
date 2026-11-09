import "server-only";
import type { EmailMessage } from "./index";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, intro: string, buttonLabel: string, url: string, outro: string) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f6f7f9;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
<p style="color:#333;line-height:1.5">${escapeHtml(intro)}</p>
<p style="margin:24px 0"><a href="${safeUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(buttonLabel)}</a></p>
<p style="color:#666;font-size:13px;line-height:1.5">${escapeHtml(outro)}<br><br>Or paste this link into your browser:<br><span style="word-break:break-all">${safeUrl}</span></p>
</div></body></html>`;
}

export function verifyEmailMessage(to: string, url: string): EmailMessage {
  const intro = "Confirm your email address to start using Coursebook.";
  const outro = "If you didn't create an account, you can ignore this email. The link expires in 1 hour.";
  return {
    to,
    subject: "Verify your email for Coursebook",
    text: `${intro}\n\n${url}\n\n${outro}`,
    html: layout("Verify your email", intro, "Verify email", url, outro),
  };
}

export function resetPasswordMessage(to: string, url: string): EmailMessage {
  const intro = "Someone (hopefully you) asked to reset your Coursebook password.";
  const outro = "If you didn't ask for this, ignore this email; your password won't change. The link expires in 1 hour.";
  return {
    to,
    subject: "Reset your Coursebook password",
    text: `${intro}\n\n${url}\n\n${outro}`,
    html: layout("Reset your password", intro, "Choose a new password", url, outro),
  };
}

export function changeEmailMessage(to: string, newEmail: string, url: string): EmailMessage {
  const intro = `Approve changing your Coursebook email address to ${newEmail}.`;
  const outro = "If you didn't request this, ignore this email and consider changing your password.";
  return {
    to,
    subject: "Confirm your new email address",
    text: `${intro}\n\n${url}\n\n${outro}`,
    html: layout("Confirm email change", intro, "Approve change", url, outro),
  };
}
