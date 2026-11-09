import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * CSRF defence for route handlers: browsers always send an Origin header on
 * POST/PUT/DELETE, so reject any request whose Origin isn't our own site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(env.APP_URL).origin;
  } catch {
    return false;
  }
}
