import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { db } from "./db";
import { env, googleAuthEnabled } from "./env";
import { sendEmail } from "./email";
import { changeEmailMessage, resetPasswordMessage, verifyEmailMessage } from "./email/templates";
import { deleteAllUserFiles } from "./courses";
import { syncOwnerRole } from "./roles";
import { recordError } from "./monitoring";

/**
 * Sends a sign-in email (verification, password reset, change of email).
 * Better Auth catches send errors and only logs them, so a broken email setup
 * would leave people waiting for a link that never comes: record the failure
 * where admins see it (Admin, and an alert), then let Better Auth carry on.
 */
async function sendAuthEmail(kind: string, message: Parameters<typeof sendEmail>[0]) {
  try {
    await sendEmail(message);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    await recordError({ kind: "server", message: `The ${kind} email couldn't be sent: ${why}`, path: "/api/auth" }).catch(() => {});
    throw err;
  }
}

export const auth = betterAuth({
  appName: "Coursebook",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Only requests from our own site may call auth endpoints (CSRF protection).
  trustedOrigins: [env.APP_URL],
  database: prismaAdapter(db, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail("password reset", resetPasswordMessage(user.email, url));
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true, // signing in unverified re-sends the link
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail("verification", verifyEmailMessage(user.email, url));
    },
  },

  socialProviders: googleAuthEnabled
    ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
    : {},

  account: {
    // A Google login with the same verified email joins the existing account.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },

  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "USER" },
      plan: { type: "string", input: false, defaultValue: "FREE" },
    },
    changeEmail: {
      enabled: true,
      // The old address approves first; then a verification link goes to the new one.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await sendAuthEmail("change of email", changeEmailMessage(user.email, newEmail, url));
      },
    },
    deleteUser: {
      enabled: true,
      // Database rows are removed by cascading deletes; files are removed here.
      beforeDelete: async (user) => {
        // A program admin hands the program over first, so its other staff and students aren't cut off.
        const shared = await db.program.count({ where: { adminId: user.id, classes: { some: { OR: [{ staff: { some: { userId: { not: user.id } } } }, { members: { some: {} } }] } } } });
        if (shared > 0) throw new APIError("BAD_REQUEST", { message: "You're the admin of a program with other staff or students. Hand the admin role to someone else first (Teaching → your program)." });
        await deleteAllUserFiles(user.id);
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    freshAge: 60 * 10, // sensitive actions need a login within the last 10 minutes (or the password)
  },

  rateLimit: {
    enabled: env.NODE_ENV === "production",
    // In the database, so the limits hold across several server instances.
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
      "/send-verification-email": { window: 300, max: 3 },
      // Two-factor codes: 5 tries a minute stops guessing (the plugin also locks after repeated failures).
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/two-factor/enable": { window: 300, max: 5 },
    },
  },

  advanced: {
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },

  // Must be last: lets Server Actions set auth cookies.
  databaseHooks: {
    session: {
      create: {
        // Last login, for the Staff page.
        after: async (session) => {
          await db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } }).catch(() => {});
          // OWNER_EMAIL may belong to an account made (or verified) after the server started.
          await syncOwnerRole().catch(() => {});
        },
      },
    },
  },

  plugins: [
    // Authenticator-app codes, with backup codes. Required for staff (src/server/access.ts).
    twoFactor({ issuer: "Coursebook", backupCodeOptions: { amount: 10, length: 10 } }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
