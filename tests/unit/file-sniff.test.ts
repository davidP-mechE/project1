import { describe, expect, it } from "vitest";
import { claimedType, cleanFilename, sniffType } from "@/lib/files/sniff";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("file signatures", () => {
  it("knows PNG, JPEG and PDF by their first bytes, and nothing else", () => {
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffType(bytes(0x89, 0x50))).toBeNull(); // too short
  });

  it("allows only matching names and claimed types", () => {
    expect(claimedType("graph.PNG", "image/png")).toBe("image/png");
    expect(claimedType("photo.jpeg", "image/jpg")).toBe("image/jpeg");
    expect(claimedType("notes.pdf", "")).toBe("application/pdf");
    expect(claimedType("notes.pdf", "image/png")).toBeNull();
    expect(claimedType("page.html", "text/html")).toBeNull();
    expect(claimedType("pic.svg", "image/svg+xml")).toBeNull();
  });

  it("cleans file names", () => {
    expect(cleanFilename("C:\\Users\\me\\My \"essay\".pdf")).toBe("My essay.pdf");
    expect(cleanFilename("../../etc/passwd.png")).toBe("passwd.png");
    expect(cleanFilename(`${"a".repeat(200)}.pdf`)).toHaveLength(120);
    expect(cleanFilename(`${"a".repeat(200)}.pdf`).endsWith(".pdf")).toBe(true);
  });
});
