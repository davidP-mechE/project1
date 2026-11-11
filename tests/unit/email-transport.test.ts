import { afterEach, describe, expect, it, vi } from "vitest";

/** Email goes through Resend's HTTP API when RESEND_API_KEY is set (no SMTP ports needed). */

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/server/email");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const message = { to: "student@example.com", subject: "Verify your email", text: "Open https://x/verify", html: "<p>Open</p>" };

describe("email transport", () => {
  it("sends through Resend's API with the key and the From address", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendEmail, emailStatus } = await load({ RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Coursebook <hello@example.com>", SMTP_HOST: "" });
    expect(emailStatus()).toMatchObject({ provider: "resend", canSend: true, from: "Coursebook <hello@example.com>" });
    await sendEmail(message);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "Coursebook <hello@example.com>", to: ["student@example.com"], subject: "Verify your email" });
  });

  it("passes on Resend's reason when it refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "The example.com domain is not verified." }), { status: 403 })));
    const { sendEmail } = await load({ RESEND_API_KEY: "re_test_key", SMTP_HOST: "" });
    await expect(sendEmail(message)).rejects.toThrow(/403.*domain is not verified/);
  });

  it("reports when nothing is set up (the email is only printed in development)", async () => {
    const { emailStatus } = await load({ RESEND_API_KEY: "", SMTP_HOST: "" });
    expect(emailStatus()).toMatchObject({ provider: "console", canSend: false });
  });
});
