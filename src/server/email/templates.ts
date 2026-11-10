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

const ROLE_WORDS: Record<string, string> = { TEACHER: "a teacher", SPECIALIST: "a specialist", VIEWER: "a viewer (read-only reports)" };

/** A staff member was added to a class (they already have an account). */
export function staffAddedMessage(input: { to: string; byName: string; className: string; role: string; scope: string; url: string }): EmailMessage {
  const intro = `${input.byName} added you to "${input.className}" on Coursebook as ${ROLE_WORDS[input.role] ?? "staff"}${input.role === "SPECIALIST" ? ` (${input.scope})` : ""}.`;
  const outro = "If you weren't expecting this, you can ignore it or ask the program admin to remove you.";
  return { to: input.to, subject: `You've been added to ${input.className}`, text: `${intro}\n\n${input.url}\n\n${outro}`, html: layout(`You've been added to ${input.className}`, intro, "Open the class", input.url, outro) };
}

/** An invitation to join a class's staff (no account yet). */
export function staffInviteMessage(input: { to: string; byName: string; className: string; role: string; scope: string; url: string; days: number }): EmailMessage {
  const intro = `${input.byName} invited you to help with "${input.className}" on Coursebook as ${ROLE_WORDS[input.role] ?? "staff"}${input.role === "SPECIALIST" ? ` (${input.scope})` : ""}.`;
  const outro = `Sign up with this email address (${input.to}) to accept. The link works for ${input.days} day${input.days === 1 ? "" : "s"}.`;
  return { to: input.to, subject: `Help with ${input.className} on Coursebook`, text: `${intro}\n\n${input.url}\n\n${outro}`, html: layout(`Join ${input.className}'s staff`, intro, "Accept the invitation", input.url, outro) };
}

/** The program admin role was handed over. */
export function adminTransferMessage(input: { to: string; fromName: string; programName: string; url: string }): EmailMessage {
  const intro = `${input.fromName} made you the admin of "${input.programName}" on Coursebook. You can now add and remove staff, manage every class, and hand the role on later.`;
  const outro = "The admin guide (linked from the program page) covers deploys, backups, staff and new semesters.";
  return { to: input.to, subject: `You're now the admin of ${input.programName}`, text: `${intro}\n\n${input.url}\n\n${outro}`, html: layout(`You're the admin of ${input.programName}`, intro, "Open the program", input.url, outro) };
}

/** The program's daily AI spending cap was reached. */
export function aiCapMessage(input: { to: string; programName: string; capUsd: string; url: string }): EmailMessage {
  const intro = `"${input.programName}" reached its daily AI spending cap of ${input.capUsd}. AI features (grading written answers, the tutor, generating lessons, reading worksheets) are paused for everyone in the program until midnight UTC.`;
  const outro = "If this was expected, you can raise the cap on the program page. If not, check the usage: it could be a bug or someone overusing it.";
  return { to: input.to, subject: `${input.programName}: daily AI cap reached`, text: `${intro}\n\n${input.url}\n\n${outro}`, html: layout("Daily AI cap reached", intro, "Open the program", input.url, outro) };
}

/** Staff: the day's alerts across their classes (names and counts only). */
export function staffDigestMessage(input: { to: string; lines: { className: string; count: number; examples: string[] }[]; url: string }): EmailMessage {
  const total = input.lines.reduce((n, l) => n + l.count, 0);
  const intro = `${total} ${total === 1 ? "alert" : "alerts"} across your classes today: ${input.lines.map((l) => `${l.className} (${l.count})`).join(", ")}.`;
  const body = input.lines.map((l) => `${l.className}:\n${l.examples.map((e) => `- ${e}`).join("\n")}${l.count > l.examples.length ? `\n- and ${l.count - l.examples.length} more` : ""}`).join("\n\n");
  const outro = "You can turn this email off in Settings → Notifications.";
  return { to: input.to, subject: `Coursebook: ${total} ${total === 1 ? "alert" : "alerts"} today`, text: `${intro}\n\n${body}\n\n${input.url}\n\n${outro}`, html: layout("Today's alerts", `${intro} ${input.lines.map((l) => l.examples.join("; ")).join("; ")}`, "Open your classes", input.url, outro) };
}

/** A guardian's weekly summary: fixed wording from the data, with a one-click unsubscribe. */
export function guardianSummaryMessage(input: { to: string; guardianName: string; studentName: string; doneThisWeek: number; overdue: string[]; attended: number; sessions: number; latestScore: string | null; focus: string | null; unsubscribeUrl: string }): EmailMessage {
  const lines = [
    `Assignments finished this week: ${input.doneThisWeek}.`,
    input.overdue.length ? `Overdue: ${input.overdue.slice(0, 5).join(", ")}${input.overdue.length > 5 ? ` and ${input.overdue.length - 5} more` : ""}.` : "Nothing overdue.",
    input.sessions ? `Sessions attended: ${input.attended} of ${input.sessions}.` : null,
    input.latestScore ? `Latest SAT score: ${input.latestScore}.` : null,
    input.focus ? `Suggested focus for next week: ${input.focus}.` : null,
  ].filter(Boolean) as string[];
  const intro = `Hi ${input.guardianName}, here's ${input.studentName}'s week in their SAT tutoring program. ${lines.join(" ")}`;
  const outro = "You're receiving this because you agreed to weekly updates. To stop them, use the link below.";
  return {
    to: input.to,
    subject: `${input.studentName}'s week in SAT tutoring`,
    text: `Hi ${input.guardianName},\n\nHere's ${input.studentName}'s week in their SAT tutoring program.\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n${outro}\nUnsubscribe: ${input.unsubscribeUrl}`,
    html: layout(`${input.studentName}'s week`, intro, "Unsubscribe", input.unsubscribeUrl, outro),
  };
}

/** A new (or recurring) error on the site, for the site admins. */
export function errorAlertMessage(input: { to: string; kind: string; message: string; path: string; count: number; url: string }): EmailMessage {
  const intro = `A ${input.kind} error ${input.count > 1 ? `has happened ${input.count} times` : "just happened"}${input.path ? ` on ${input.path}` : ""}: "${input.message}".`;
  const outro = "Details are on the admin page. The admin guide (ADMIN_GUIDE.md) says what to do.";
  return { to: input.to, subject: `Coursebook error: ${input.message.slice(0, 60)}`, text: `${intro}\n\n${input.url}\n\n${outro}`, html: layout("Something broke", intro, "Open the admin page", input.url, outro) };
}

/** Someone pressed "Report a problem". */
export function problemReportMessage(input: { to: string; path: string; note: string; errorIds: string[]; userAgent: string; url: string }): EmailMessage {
  const intro = `Someone reported a problem on ${input.path || "the site"}${input.note ? `: "${input.note}"` : "."}${input.errorIds.length ? ` Recent error ids: ${input.errorIds.join(", ")}.` : ""} Browser: ${input.userAgent}.`;
  const outro = "Reports are listed on the admin page.";
  return { to: input.to, subject: "Coursebook: a problem was reported", text: `${intro}\n\n${input.url}\n\n${outro}`, html: layout("A problem was reported", intro, "Open the admin page", input.url, outro) };
}
