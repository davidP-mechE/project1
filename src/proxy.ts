import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, storageOrigins } from "@/lib/security/csp";

/**
 * Runs before every page request: creates a fresh nonce and sends the
 * Content-Security-Policy (see src/lib/security/csp.ts). Next.js reads the
 * nonce from the request's CSP header and adds it to its own scripts.
 */
const origins = storageOrigins(process.env);
const https = (process.env.APP_URL ?? "").startsWith("https://");

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", https, storageOrigins: origins, desmos: Boolean(process.env.DESMOS_API_KEY) });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not API routes, static files, or the PDF viewer's assets.
      source: "/((?!api|_next/static|_next/image|favicon.ico|pdfjs).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
