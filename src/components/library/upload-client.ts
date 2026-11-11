/** Browser-side upload helpers, shared by the upload form and "Add slides". */

export type UploadTarget = { url: string; headers: Record<string, string> };

/** Upload straight to storage with XMLHttpRequest, because fetch() can't report upload progress. */
export function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (pct: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

export async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

/** Upload several decks one after another, reporting progress across all of them (by size). */
export async function uploadDecks(
  uploads: { deckId: string; filename: string; upload: UploadTarget }[],
  files: File[],
  onProgress: (pct: number) => void,
  signal: AbortSignal,
) {
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  for (const [i, u] of uploads.entries()) {
    const file = files[i];
    await putWithProgress(u.upload.url, file, u.upload.headers, (pct) => onProgress(((done + (file.size * pct) / 100) / total) * 100), signal);
    done += file.size;
  }
}
