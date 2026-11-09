import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@/server/storage/local";
import { signOp, verifyOp } from "@/server/storage/signing";
import { assertSafeKey, storageKeys } from "@/server/storage/types";

const SECRET = "unit-test-secret";

describe("signed URLs", () => {
  const op = { method: "PUT" as const, key: "users/u1/books/b1/original.pdf", expires: 2_000_000_000, maxBytes: 100 };

  it("verifies a correct signature", () => expect(verifyOp(op, signOp(op, SECRET), SECRET)).toBe(true));
  it("rejects a tampered key, method or size", () => {
    const sig = signOp(op, SECRET);
    expect(verifyOp({ ...op, key: "users/u2/books/b1/original.pdf" }, sig, SECRET)).toBe(false);
    expect(verifyOp({ ...op, method: "GET" }, sig, SECRET)).toBe(false);
    expect(verifyOp({ ...op, maxBytes: 999999 }, sig, SECRET)).toBe(false);
  });
  it("rejects a wrong secret", () => expect(verifyOp(op, signOp(op, "other"), SECRET)).toBe(false));
  it("rejects expired links", () => {
    const expired = { ...op, expires: 1000 };
    expect(verifyOp(expired, signOp(expired, SECRET), SECRET)).toBe(false);
  });
});

describe("assertSafeKey", () => {
  it("allows normal keys", () => expect(() => assertSafeKey(storageKeys.bookOriginal("u1", "b1"))).not.toThrow());
  it.each(["../etc/passwd", "/abs/path", "users/../x", "users//x", "a\\b", "users/a b", ""])("blocks %j", (key) => {
    expect(() => assertSafeKey(key)).toThrow();
  });
});

describe("LocalStorage", () => {
  let dir: string;
  let store: LocalStorage;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-storage-"));
    store = new LocalStorage(dir, "http://localhost:3000", SECRET);
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  const stream = (data: Buffer) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        // Send in two chunks to exercise the size counter.
        c.enqueue(new Uint8Array(data.subarray(0, 5)));
        c.enqueue(new Uint8Array(data.subarray(5)));
        c.close();
      },
    });

  it("writes a stream, reports size, and reads byte ranges", async () => {
    const data = Buffer.from("0123456789abcdef");
    const n = await store.writeStream("users/u1/books/b1/original.pdf", stream(data), 100);
    expect(n).toBe(16);
    expect(await store.head("users/u1/books/b1/original.pdf")).toEqual({ size: 16 });
    expect((await store.readRange("users/u1/books/b1/original.pdf", 2, 5)).toString()).toBe("2345");
    expect((await store.readRange("users/u1/books/b1/original.pdf", 10, 1000)).toString()).toBe("abcdef");
  });

  it("aborts uploads over the size limit and leaves no file behind", async () => {
    await expect(store.writeStream("users/u1/books/b2/original.pdf", stream(Buffer.alloc(50)), 10)).rejects.toThrow(
      "UPLOAD_TOO_LARGE",
    );
    expect(await store.head("users/u1/books/b2/original.pdf")).toBeNull();
    const files = await fs.readdir(path.join(dir, "users/u1/books/b2")).catch(() => []);
    expect(files).toEqual([]);
  });

  it("returns null for missing files", async () => expect(await store.head("users/nobody/x.pdf")).toBeNull());

  it("deletes a whole prefix without touching other users", async () => {
    await store.put("users/u1/books/b3/original.pdf", Buffer.from("x"));
    await store.put("users/u2/books/b9/original.pdf", Buffer.from("y"));
    await store.deletePrefix(storageKeys.userPrefix("u1"));
    expect(await store.head("users/u1/books/b3/original.pdf")).toBeNull();
    expect(await store.head("users/u2/books/b9/original.pdf")).toEqual({ size: 1 });
  });

  it("creates signed upload URLs that verify", async () => {
    const target = await store.createUploadUrl("users/u1/books/b1/original.pdf", {
      contentType: "application/pdf",
      contentLength: 16,
      expiresInSeconds: 60,
    });
    const url = new URL(target.url);
    expect(url.pathname).toBe("/api/storage/local/users/u1/books/b1/original.pdf");
    const ok = verifyOp(
      {
        method: "PUT",
        key: "users/u1/books/b1/original.pdf",
        expires: Number(url.searchParams.get("expires")),
        maxBytes: Number(url.searchParams.get("maxBytes")),
      },
      url.searchParams.get("sig")!,
      SECRET,
    );
    expect(ok).toBe(true);
  });
});
