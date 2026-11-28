import "server-only";
import crypto from "node:crypto";
import { assertSecrets, env } from "./env";

/**
 * Field-level encryption for sensitive text (spec: "sensitive fields encrypted at
 * the field level with keys in a managed key service").
 *
 * Prototype: one AES-256-GCM data key from COACH_DATA_KEY (32 bytes, base64).
 * Production: replace `dataKey()` with envelope encryption, a per-user data key
 * wrapped by the cloud KMS, so deleting a user's key also erases their backups.
 */

let cached: Buffer | null = null;
function dataKey(): Buffer {
  if (cached) return cached;
  assertSecrets();
  if (env.COACH_DATA_KEY) cached = Buffer.from(env.COACH_DATA_KEY, "base64");
  else cached = crypto.createHash("sha256").update(`dev-data-key:${env.COACH_COOKIE_SECRET || "dev"}`).digest();
  if (cached.length !== 32) throw new Error("COACH_DATA_KEY must be 32 bytes, base64");
  return cached;
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function unseal(sealed: string): string {
  if (!sealed.startsWith("v1:")) return sealed;
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const sealJson = (v: unknown) => seal(JSON.stringify(v));
export const unsealJson = <T,>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(unseal(s)) as T) : fallback);

/** HMAC signature for the anonymous identity cookie. */
export function sign(value: string): string {
  assertSecrets();
  const mac = crypto.createHmac("sha256", env.COACH_COOKIE_SECRET || "dev-cookie-secret").update(value).digest("base64url");
  return `${value}.${mac}`;
}
export function verify(signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = sign(value);
  const a = Buffer.from(expected);
  const b = Buffer.from(signed);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}
