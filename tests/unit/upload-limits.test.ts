import { describe, expect, it } from "vitest";
import { formatBytes, MAX_UPLOAD_BYTES, titleFromFilename, validateUploadRequest } from "@/lib/upload/limits";

const ok = { filename: "Physics.pdf", size: 1000, contentType: "application/pdf", rightsConfirmed: true };

describe("validateUploadRequest", () => {
  it("accepts a normal PDF", () => expect(validateUploadRequest(ok)).toEqual({ ok: true }));
  it("requires the rights confirmation", () =>
    expect(validateUploadRequest({ ...ok, rightsConfirmed: false }).ok).toBe(false));
  it("rejects non-.pdf names", () => expect(validateUploadRequest({ ...ok, filename: "book.docx" }).ok).toBe(false));
  it("accepts an empty or generic content type (some browsers send these)", () => {
    expect(validateUploadRequest({ ...ok, contentType: "" }).ok).toBe(true);
    expect(validateUploadRequest({ ...ok, contentType: "application/octet-stream" }).ok).toBe(true);
  });
  it("rejects other content types", () => expect(validateUploadRequest({ ...ok, contentType: "image/png" }).ok).toBe(false));
  it("rejects empty files", () => expect(validateUploadRequest({ ...ok, size: 0 }).ok).toBe(false));
  it("allows exactly the limit and rejects 1 byte over", () => {
    expect(validateUploadRequest({ ...ok, size: MAX_UPLOAD_BYTES }).ok).toBe(true);
    const res = validateUploadRequest({ ...ok, size: MAX_UPLOAD_BYTES + 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("200.0 MB");
  });
});

describe("titleFromFilename", () => {
  it("cleans up underscores and dashes", () =>
    expect(titleFromFilename("Intro_to_Circuits-3rd_ed.PDF")).toBe("Intro to Circuits 3rd ed"));
  it("falls back for empty names", () => expect(titleFromFilename(".pdf")).toBe("Untitled textbook"));
  it("caps length", () => expect(titleFromFilename(`${"a".repeat(500)}.pdf`)).toHaveLength(200));
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
