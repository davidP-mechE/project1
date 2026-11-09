/**
 * Give an account the admin role (or take it away). The account must exist:
 * sign up in the app first.
 *
 *   npm run admin:grant -- you@example.com
 *   npm run admin:grant -- you@example.com --revoke
 *
 * Uses DATABASE_URL from .env (or the environment, e.g. in production).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  const revoke = args.includes("--revoke");
  if (!email || !process.env.DATABASE_URL) {
    console.error("Usage: npm run admin:grant -- you@example.com [--revoke]   (needs DATABASE_URL)");
    process.exit(1);
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (!user) {
      console.error(`No account with the email ${email}. Sign up in the app first.`);
      process.exit(1);
    }
    await db.user.update({ where: { id: user.id }, data: { role: revoke ? "USER" : "ADMIN" } });
    console.log(revoke ? `${email} is no longer an admin.` : `${email} is now an admin. Open /admin (from the account menu).`);
  } finally {
    await db.$disconnect();
  }
}

void main();
