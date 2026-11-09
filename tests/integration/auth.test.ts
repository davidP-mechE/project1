import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

describe("email + password auth", () => {
  it("signs up an unverified user, hashes the password, and sends a verification email", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "correct horse battery" } });

    const user = await db.user.findUniqueOrThrow({ where: { email: "ada@example.com" }, include: { accounts: true } });
    expect(user.emailVerified).toBe(false);
    expect(user.role).toBe("USER");
    const stored = user.accounts[0]?.password ?? "";
    expect(stored).not.toContain("correct horse battery"); // only a hash is stored
    expect(stored.length).toBeGreaterThan(40);

    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Verify your email for Coursebook");
    expect(printed).toMatch(/\/api\/auth\/verify-email\?token=/);
    log.mockRestore();
  });

  it("refuses to log in until the email is verified", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "correct horse battery" } });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "correct horse battery" } }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await db.user.update({ where: { email: "ada@example.com" }, data: { emailVerified: true } });
    const res = await auth.api.signInEmail({ body: { email: "ada@example.com", password: "correct horse battery" } });
    expect(res.user.email).toBe("ada@example.com");
    expect(res.token).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "correct horse battery" } });
    await db.user.update({ where: { email: "ada@example.com" }, data: { emailVerified: true } });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "wrong password!" } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Ada", email: "short@example.com", password: "short" } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
