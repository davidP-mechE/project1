import { describe, expect, it } from "vitest";
import { checkPdfSignature } from "@/lib/pdf/validate";
import { makePdf } from "../helpers/pdf";

const headTail = (buf: Buffer) => [buf.subarray(0, 1024), buf.subarray(Math.max(0, buf.length - 2048))] as const;

describe("checkPdfSignature", () => {
  it("accepts a real PDF and reports its version", () => {
    const res = checkPdfSignature(...headTail(makePdf()));
    expect(res).toEqual({ ok: true, version: "1.4" });
  });

  it("accepts a header that is not at byte 0 (allowed by the PDF spec)", () => {
    const buf = Buffer.concat([Buffer.from("junk-bytes\n"), makePdf()]);
    expect(checkPdfSignature(...headTail(buf)).ok).toBe(true);
  });

  it("rejects a file without a PDF header", () => {
    const buf = Buffer.from("PK\x03\x04 this is a zip file %%EOF");
    const res = checkPdfSignature(...headTail(buf));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/isn't a PDF/);
  });

  it("rejects a truncated PDF (no %%EOF)", () => {
    const full = makePdf();
    const cut = full.subarray(0, full.length - 20);
    const res = checkPdfSignature(...headTail(cut));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/incomplete or damaged/);
  });

  it("rejects an encrypted PDF", () => {
    const buf = Buffer.from(makePdf().toString("latin1").replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 9 0 R"), "latin1");
    const res = checkPdfSignature(...headTail(buf));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/password-protected/);
  });
});
