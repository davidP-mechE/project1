import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { env, googleAuthEnabled } from "./env";
import { sendEmail } from "./email";
import { changeEmailMessage, resetPasswordMessage, verifyEmailMessage } from "./email/templates";
import { deleteAllUserFiles } from "./courses";

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
      await sendEmail(resetPasswordMessage(user.email, url));
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true, // signing in unverified re-sends the link
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(verifyEmailMessage(user.email, url));
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
        await sendEmail(changeEmailMessage(user.email, newEmail, url));
      },
    },
    deleteUser: {
      enabled: true,
      // Database rows are removed by cascading deletes; files are removed here.
      beforeDelete: async (user) => {
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
    },
  },

  advanced: {
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },

  // Must be last: lets Server Actions set auth cookies.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
