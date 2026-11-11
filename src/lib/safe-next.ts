/** Where to go after logging in or signing up: only a path on this site (never another site), e.g. "/join/ABC2345". */
export const safeNext = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/]*$/.test(v) && v.length < 200 ? v : "/library");
