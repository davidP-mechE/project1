import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { signOp } from "./signing";
import { assertSafeKey, type StorageDriver, type UploadTarget } from "./types";

/** Stores files under a folder on disk. Development only. */
export class LocalStorage implements StorageDriver {
  constructor(
    private readonly rootDir: string,
    private readonly appUrl: string,
    private readonly secret: string,
  ) {}

  resolvePath(key: string): string {
    assertSafeKey(key);
    const root = path.resolve(this.rootDir);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Key escapes storage root");
    return full;
  }

  private signedUrl(method: "PUT" | "GET", key: string, expiresInSeconds: number, maxBytes?: number) {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = signOp({ method, key, expires, maxBytes }, this.secret);
    const params = new URLSearchParams({ expires: String(expires), sig });
    if (maxBytes !== undefined) params.set("maxBytes", String(maxBytes));
    return `${this.appUrl}/api/storage/local/${key}?${params}`;
  }

  async createUploadUrl(
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<UploadTarget> {
    assertSafeKey(key);
    return {
      url: this.signedUrl("PUT", key, opts.expiresInSeconds, opts.contentLength),
      method: "PUT",
      headers: { "Content-Type": opts.contentType },
    };
  }

  async createDownloadUrl(key: string, opts: { expiresInSeconds: number }): Promise<string> {
    return this.signedUrl("GET", key, opts.expiresInSeconds);
  }

  async head(key: string) {
    try {
      const stat = await fs.stat(this.resolvePath(key));
      return { size: stat.size };
    } catch {
      return null;
    }
  }

  async readRange(key: string, start: number, end: number): Promise<Buffer> {
    const handle = await fs.open(this.resolvePath(key), "r");
    try {
      const length = Math.max(0, end - start + 1);
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async getBuffer(key: string) {
    return fs.readFile(this.resolvePath(key));
  }

  async put(key: string, body: Buffer) {
    const full = this.resolvePath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  /**
   * Stream an upload to disk, aborting if it exceeds maxBytes. Writes to a
   * temporary file first so a failed upload never leaves a half-written file.
   */
  async writeStream(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
    const full = this.resolvePath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.uploading-${process.pid}-${Date.now()}`;
    let written = 0;
    const limiter = async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        written += chunk.byteLength;
        if (written > maxBytes) throw new Error("UPLOAD_TOO_LARGE");
        yield chunk;
      }
    };
    try {
      await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), limiter, createWriteStream(tmp));
      await fs.rename(tmp, full);
      return written;
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolvePath(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    // prefix must look like "users/<id>/..." with a trailing slash.
    const trimmed = prefix.replace(/\/$/, "");
    await fs.rm(this.resolvePath(trimmed), { recursive: true, force: true });
  }
}
