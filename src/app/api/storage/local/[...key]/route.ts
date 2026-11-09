import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { env } from "@/server/env";
import { LocalStorage } from "@/server/storage/local";
import { verifyOp } from "@/server/storage/signing";
import { jsonError } from "@/server/http";

/**
 * Development stand-in for S3: accepts uploads and serves downloads for the
 * local-disk storage driver. Every request must carry a valid signature
 * created by the server, exactly like an S3 pre-signed URL.
 * Disabled unless STORAGE_DRIVER=local.
 */

const local = new LocalStorage(env.LOCAL_STORAGE_DIR, env.APP_URL, env.BETTER_AUTH_SECRET);

async function parse(request: Request, ctx: RouteContext<"/api/storage/local/[...key]">, method: "PUT" | "GET") {
  if (env.STORAGE_DRIVER !== "local") return { error: jsonError("Not found", 404) };
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires"));
  const maxBytesParam = url.searchParams.get("maxBytes");
  const maxBytes = maxBytesParam === null ? undefined : Number(maxBytesParam);
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifyOp({ method, key, expires, maxBytes }, sig, env.BETTER_AUTH_SECRET)) {
    return { error: jsonError("This link is invalid or has expired.", 403) };
  }
  return { key, maxBytes };
}

export async function PUT(request: Request, ctx: RouteContext<"/api/storage/local/[...key]">) {
  const p = await parse(request, ctx, "PUT");
  if ("error" in p) return p.error;
  if (!request.body) return jsonError("Empty upload", 400);
  try {
    await local.writeStream(p.key, request.body, p.maxBytes ?? 0);
  } catch (err) {
    if ((err as Error).message === "UPLOAD_TOO_LARGE") return jsonError("File is larger than allowed.", 413);
    throw err;
  }
  return new Response(null, { status: 200 });
}

export async function GET(request: Request, ctx: RouteContext<"/api/storage/local/[...key]">) {
  const p = await parse(request, ctx, "GET");
  if ("error" in p) return p.error;
  const full = local.resolvePath(p.key);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) return jsonError("Not found", 404);

  const contentType = p.key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  // Range requests let the PDF viewer load only the pages it needs.
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
    },
  });
}
