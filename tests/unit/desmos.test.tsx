import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesmosGraph } from "@/components/desmos/desmos-graph";
import { CalculatorPanel } from "@/components/desmos/calculator-panel";
import { buildCsp } from "@/lib/security/csp";
import { DESMOS_API_VERSION } from "@/lib/desmos/loader";

describe("Desmos", () => {
  it("without DESMOS_API_KEY, shows a short note and a link to desmos.com/calculator", () => {
    const html = renderToStaticMarkup(<DesmosGraph apiKey={null} />);
    expect(html).toContain("isn&#x27;t set up on this site");
    expect(html).toContain('href="https://www.desmos.com/calculator"');
  });

  it("a by-hand assignment renders no calculator at all", () => {
    expect(renderToStaticMarkup(<CalculatorPanel apiKey="k" storageKey="s" byHand />)).toBe("");
    expect(renderToStaticMarkup(<CalculatorPanel apiKey="k" storageKey="s" />)).toContain("Calculator");
  });

  it("the Content-Security-Policy allows desmos.com only when a key is set", () => {
    const base = { nonce: "n", dev: false, https: true, storageOrigins: [] };
    expect(buildCsp({ ...base, desmos: true })).toContain("https://www.desmos.com");
    expect(buildCsp({ ...base, desmos: false })).not.toContain("desmos.com");
    expect(DESMOS_API_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});
