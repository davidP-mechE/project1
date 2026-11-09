import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed URLs for the local-disk storage driver. They play the same role as
 * S3 pre-signed URLs: the URL itself proves the server allowed this exact
 * operation (method + key + size limit) until the expiry time.
 */
export type SignedOp = { method: "PUT" | "GET"; key: string; expires: number; maxBytes?: number };

function payload(op: SignedOp) {
  return `${op.method}\n${op.key}\n${op.expires}\n${op.maxBytes ?? ""}`;
}

export function signOp(op: SignedOp, secret: string): string {
  return createHmac("sha256", secret).update(payload(op)).digest("base64url");
}

export function verifyOp(op: SignedOp, signature: string, secret: string, nowMs = Date.now()): boolean {
  if (!Number.isFinite(op.expires) || op.expires * 1000 < nowMs) return false;
  const expected = Buffer.from(signOp(op, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
