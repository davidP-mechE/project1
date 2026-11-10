/**
 * The Content-Security-Policy sent with every page. Scripts must carry the
 * per-request nonce (Next.js adds it to its own scripts automatically), so an
 * injected <script> can't run even if some HTML slipped through.
 *
 * - style-src allows inline styles: React `style={…}` props and KaTeX math need them.
 * - 'wasm-unsafe-eval' lets the PDF viewer use its WebAssembly image decoders.
 * - Storage origins (S3/R2) are allowed for direct uploads and the PDF file.
 */
export type CspOptions = { nonce: string; dev: boolean; https: boolean; storageOrigins: string[]; desmos?: boolean };

/** The Desmos graphing calculator (only when a Desmos API key is set). Its script loads through our own code, which 'strict-dynamic' allows. */
const DESMOS = "https://www.desmos.com";

export function buildCsp({ nonce, dev, https, storageOrigins, desmos = false }: CspOptions): string {
  const storage = [...storageOrigins, ...(desmos ? [DESMOS] : [])].join(" ");
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`],
    ["style-src", `'self' 'unsafe-inline'${desmos ? ` ${DESMOS}` : ""}`],
    ["img-src", `'self' data: blob:${storage ? ` ${storage}` : ""}`],
    ["font-src", `'self' data:${desmos ? ` ${DESMOS}` : ""}`],
    ["connect-src", `'self'${storage ? ` ${storage}` : ""}`],
    ["worker-src", "'self' blob:"],
    ["frame-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'self'"],
  ];
  const policy = directives.map(([k, v]) => `${k} ${v}`);
  if (https) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Where the browser talks to file storage directly (uploads, PDF downloads). */
export function storageOrigins(env: Record<string, string | undefined>): string[] {
  if (env.STORAGE_DRIVER !== "s3") return [];
  if (env.S3_ENDPOINT) {
    try {
      return [new URL(env.S3_ENDPOINT).origin];
    } catch {
      return [];
    }
  }
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION && env.S3_REGION !== "auto" ? env.S3_REGION : "us-east-1";
  return bucket ? [`https://${bucket}.s3.${region}.amazonaws.com`, `https://${bucket}.s3.amazonaws.com`] : [];
}
