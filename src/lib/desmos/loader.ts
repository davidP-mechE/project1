/**
 * Loads the Desmos API script once, lazily, only on pages that render a Desmos
 * component. Check https://www.desmos.com/api for the current version and its
 * terms (including commercial use) before launch; change it here only.
 *
 * Privacy: the script URL carries only the API key. Graph state is the only
 * thing ever handed to Desmos: no names, emails or ids.
 */
export const DESMOS_API_VERSION = "v1.11";
export const DESMOS_CALCULATOR_URL = "https://www.desmos.com/calculator";

export type DesmosCalculator = {
  destroy: () => void;
  getState: () => object;
  setState: (state: object, opts?: { allowUndo?: boolean }) => void;
  setBlank: () => void;
  updateSettings: (s: Record<string, unknown>) => void;
  resize: () => void;
  observeEvent: (e: string, cb: () => void) => void;
  unobserveEvent?: (e: string) => void;
};

declare global {
  interface Window {
    Desmos?: { GraphingCalculator: (el: HTMLElement, opts: object) => DesmosCalculator };
  }
}

let loading: Promise<void> | null = null;

export function loadDesmos(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Desmos runs in the browser only."));
  if (window.Desmos) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.desmos.com/api/${DESMOS_API_VERSION}/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
    s.async = true;
    s.onload = () => (window.Desmos ? resolve() : reject(new Error("Desmos didn't load")));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("Desmos didn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}
