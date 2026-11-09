import { describe, expect, it } from "vitest";
import {
  checkAiBudget,
  checkGeneration,
  checkUpload,
  DEFAULT_LIMITS,
  formatSize,
  limitsFromEnv,
  periodEnd,
  periodStart,
  usageMeters,
} from "@/lib/usage/limits";
import { fixedWindow, RATE_RULES } from "@/lib/usage/rate-limit";
import { buildCsp, storageOrigins } from "@/lib/security/csp";

const FREE = DEFAULT_LIMITS.FREE;
const now = new Date("2026-11-09T15:30:00Z");

describe("usage period", () => {
  it("is the calendar month in UTC", () => {
    expect(periodStart(now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(periodEnd(now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(periodEnd(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(periodStart(new Date("2026-03-01T00:00:00Z")).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("limitsFromEnv", () => {
  it("uses the defaults, and valid overrides per plan", () => {
    expect(limitsFromEnv({})).toEqual(DEFAULT_LIMITS);
    const l = limitsFromEnv({ FREE_MONTHLY_AI_USD: "20", PRO_PAGES_PER_MONTH: "10000.7", FREE_STORAGE_GB: "0.5", PRO_MAX_BOOKS: "-3", FREE_MAX_BOOKS: "abc" });
    expect(l.FREE.monthlyAiUsd).toBe(20);
    expect(l.FREE.storageBytes).toBe(512 * 1024 * 1024);
    expect(l.FREE.maxBooks).toBe(DEFAULT_LIMITS.FREE.maxBooks); // invalid: ignored
    expect(l.PRO.pagesPerMonth).toBe(10000);
    expect(l.PRO.maxBooks).toBe(DEFAULT_LIMITS.PRO.maxBooks); // negative: ignored
  });
  it("gives Pro more than Free", () => {
    for (const k of Object.keys(FREE) as (keyof typeof FREE)[]) expect(DEFAULT_LIMITS.PRO[k]).toBeGreaterThan(FREE[k]);
  });
});

describe("checkAiBudget", () => {
  it("allows until the monthly allowance is used, and says when it resets", () => {
    expect(checkAiBudget({ aiUsd: 4.99 }, FREE, now)).toEqual({ ok: true });
    const r = checkAiBudget({ aiUsd: 5 }, FREE, now);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("December 1");
  });
});

describe("checkGeneration", () => {
  it("checks pages left, then the estimated cost", () => {
    expect(checkGeneration({ aiUsd: 0, pages: 0 }, { newPages: 500, estimateUsd: 4.9 }, FREE, now)).toEqual({ ok: true });
    const pages = checkGeneration({ aiUsd: 0, pages: 450 }, { newPages: 60, estimateUsd: 0.5 }, FREE, now);
    expect(!pages.ok && pages.error).toContain("50 of 500 pages left");
    const none = checkGeneration({ aiUsd: 0, pages: 500 }, { newPages: 1, estimateUsd: 0 }, FREE, now);
    expect(!none.ok && none.error).toContain("monthly limit");
    const cost = checkGeneration({ aiUsd: 4, pages: 0 }, { newPages: 100, estimateUsd: 1.5 }, FREE, now);
    expect(!cost.ok && cost.error).toContain("$1.00 of this month's $5.00");
  });
  it("is blocked outright once the allowance is used, even for already-counted pages", () => {
    expect(checkGeneration({ aiUsd: 5.01, pages: 0 }, { newPages: 0, estimateUsd: 0 }, FREE, now).ok).toBe(false);
    expect(checkGeneration({ aiUsd: 1, pages: 500 }, { newPages: 0, estimateUsd: 0.2 }, FREE, now).ok).toBe(true);
  });
});

describe("checkUpload", () => {
  it("limits the number of books and total storage", () => {
    expect(checkUpload({ books: 9, storageBytes: 0 }, 10, FREE)).toEqual({ ok: true });
    expect(checkUpload({ books: 10, storageBytes: 0 }, 10, FREE).ok).toBe(false);
    const full = checkUpload({ books: 1, storageBytes: FREE.storageBytes - 1024 * 1024 }, 5 * 1024 * 1024, FREE);
    expect(!full.ok && full.error).toContain("1 MB left of 2 GB");
  });
});

describe("usageMeters", () => {
  it("shows each limit with a capped fraction", () => {
    const m = usageMeters({ aiUsd: 1.25, pages: 600, books: 2, storageBytes: 300 * 1024 * 1024 }, FREE);
    expect(m.map((r) => r.text)).toEqual(["$1.25 of $5.00", "600 of 500", "2 of 10", "300 MB of 2 GB"]);
    expect(m[0].fraction).toBeCloseTo(0.25);
    expect(m[1].fraction).toBe(1);
    expect(formatSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});

describe("rate-limit windows", () => {
  it("buckets time into fixed windows and says when the window ends", () => {
    const a = fixedWindow(60_000 * 10 + 5_000, 60);
    expect(a).toEqual({ bucket: 10, resetsInMs: 55_000 });
    expect(fixedWindow(60_000 * 11, 60).bucket).toBe(11);
    for (const r of Object.values(RATE_RULES)) {
      expect(r.max).toBeGreaterThan(0);
      expect(r.windowSeconds).toBeGreaterThan(0);
    }
  });
});

describe("Content-Security-Policy", () => {
  it("requires the nonce for scripts and never allows unsafe-inline scripts", () => {
    const csp = buildCsp({ nonce: "abc", dev: false, https: true, storageOrigins: [] });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("allows eval only in development, and the storage origin for uploads and files", () => {
    const csp = buildCsp({ nonce: "n", dev: true, https: false, storageOrigins: ["https://acc.r2.cloudflarestorage.com"] });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(csp).toContain("connect-src 'self' https://acc.r2.cloudflarestorage.com");
    expect(csp).toContain("img-src 'self' data: blob: https://acc.r2.cloudflarestorage.com");
  });
  it("works out storage origins from the environment", () => {
    expect(storageOrigins({ STORAGE_DRIVER: "local" })).toEqual([]);
    expect(storageOrigins({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com/" })).toEqual(["https://acc.r2.cloudflarestorage.com"]);
    expect(storageOrigins({ STORAGE_DRIVER: "s3", S3_BUCKET: "books", S3_REGION: "eu-west-1" })).toEqual([
      "https://books.s3.eu-west-1.amazonaws.com",
      "https://books.s3.amazonaws.com",
    ]);
    expect(storageOrigins({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "not a url" })).toEqual([]);
  });
});
