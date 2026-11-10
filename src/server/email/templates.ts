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

export function reminderMessage(input: {
  to: string;
  name: string;
  minutesToday: number;
  goal: number;
  cardsDue: number;
  planLessons: number;
  streak: number;
  studiedToday: boolean;
  appUrl: string;
  unsubscribeUrl: string;
}): EmailMessage {
  const first = input.name.split(" ")[0] || "there";
  const left = Math.max(0, input.goal - input.minutesToday);
  const lines = [
    input.streak > 0 && !input.studiedToday ? `You're on a ${input.streak}-day streak. Study today to keep it going.` : null,
    input.minutesToday > 0 ? `You've studied ${input.minutesToday} of your ${input.goal} minutes today: ${left} to go.` : `Your goal is ${input.goal} minutes a day.`,
    input.cardsDue > 0 ? `${input.cardsDue} flashcard${input.cardsDue === 1 ? " is" : "s are"} ready for review (about ${Math.max(1, Math.round(input.cardsDue / 4))} min).` : null,
    input.planLessons > 0 ? `${input.planLessons} lesson${input.planLessons === 1 ? "" : "s"} from your study plan ${input.planLessons === 1 ? "is" : "are"} due.` : null,
  ].filter((l): l is string => Boolean(l));
  const subject = input.streak > 0 && !input.studiedToday ? `Keep your ${input.streak}-day streak going` : "A few minutes of studying today?";
  const url = `${input.appUrl}/dashboard`;
  const outro = "You're getting this because you turned on daily reminders in Coursebook.";
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f6f7f9;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">Hi ${escapeHtml(first)} 👋</h1>
${lines.map((l) => `<p style="color:#333;line-height:1.5;margin:0 0 8px">${escapeHtml(l)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Start studying</a></p>
<p style="color:#666;font-size:13px;line-height:1.5">${escapeHtml(outro)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#666">Turn off reminders</a>.</p>
</div></body></html>`;
  return {
    to: input.to,
    subject,
    text: `Hi ${first},\n\n${lines.join("\n")}\n\nStart studying: ${url}\n\n${outro}\nTurn off reminders: ${input.unsubscribeUrl}`,
    html,
  };
}

export function classInviteMessage(input: { to: string; teacherName: string; className: string; code: string; url: string }): EmailMessage {
  const intro = `${input.teacherName} invited you to join "${input.className}" on Coursebook, where you'll find the lessons and worksheets they assign.`;
  const outro = `No account yet? Sign up with this email address, then open the link again. Or enter the class code ${input.code} under Classes.`;
  return {
    to: input.to,
    subject: `Join ${input.className} on Coursebook`,
    text: `${intro}\n\n${input.url}\n\n${outro}`,
    html: layout(`Join ${input.className}`, intro, "Join the class", input.url, outro),
  };
}
