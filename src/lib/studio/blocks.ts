import { z } from "zod";

/**
 * Course Studio content blocks added for the SAT course packets: video,
 * callout, checkpoint, and the "Try it in Desmos" form of the Desmos block.
 * Pure (shared by the server, the importer and the pages).
 */

// ─── YouTube ──────────────────────────────────────────────────────────────

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

export type YouTubeRef = { provider: "youtube"; videoId: string } | { provider: "youtube_playlist"; playlistId: string };

/**
 * Any pasted YouTube link → a video or playlist id: youtube.com/watch?v=, youtu.be/, /shorts/, /embed/,
 * /live/, youtube.com/playlist?list=, and youtube-nocookie.com. A watch link with a list plays the video.
 * Returns null for anything else.
 */
export function parseYouTubeUrl(raw: string): YouTubeRef | null {
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  const video = (id: string | null | undefined): YouTubeRef | null => (id && VIDEO_ID.test(id) ? { provider: "youtube", videoId: id } : null);
  if (host === "youtu.be") return video(u.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "watch") return video(u.searchParams.get("v"));
  if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) {
    if (parts[0] === "embed" && parts[1] === "videoseries") {
      const list = u.searchParams.get("list");
      return list && PLAYLIST_ID.test(list) ? { provider: "youtube_playlist", playlistId: list } : null;
    }
    return video(parts[1]);
  }
  if (parts[0] === "playlist") {
    const list = u.searchParams.get("list");
    return list && PLAYLIST_ID.test(list) ? { provider: "youtube_playlist", playlistId: list } : null;
  }
  return null;
}

/** Privacy-enhanced embed URL (youtube-nocookie.com), autoplaying because it's loaded on click. */
export function embedUrl(v: YouTubeRef): string {
  return v.provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0` : `https://www.youtube-nocookie.com/embed/videoseries?list=${v.playlistId}&autoplay=1&rel=0`;
}
export const watchUrl = (v: YouTubeRef) => (v.provider === "youtube" ? `https://www.youtube.com/watch?v=${v.videoId}` : `https://www.youtube.com/playlist?list=${v.playlistId}`);
export const thumbnailUrl = (v: YouTubeRef) => (v.provider === "youtube" ? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg` : null);

// ─── Block data ───────────────────────────────────────────────────────────

export const REVIEW_STATUSES = ["unreviewed", "approved", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const text = (max: number) => z.string().max(max);

export const VideoDataSchema = z.object({
  provider: z.enum(["youtube", "youtube_playlist"]),
  videoId: z.string().regex(VIDEO_ID).optional(),
  playlistId: z.string().regex(PLAYLIST_ID).optional(),
  url: text(500),
  title: text(300),
  whyWatch: text(1000).default(""),
  reviewStatus: z.enum(REVIEW_STATUSES).default("unreviewed"),
});
export type VideoData = z.infer<typeof VideoDataSchema>;

export const videoRef = (d: VideoData): YouTubeRef | null =>
  d.provider === "youtube" && d.videoId ? { provider: "youtube", videoId: d.videoId } : d.provider === "youtube_playlist" && d.playlistId ? { provider: "youtube_playlist", playlistId: d.playlistId } : null;

/** A pasted link and its title → video block data (null if the link isn't YouTube). */
export function videoFromUrl(url: string, title: string, whyWatch = "", reviewStatus: ReviewStatus = "unreviewed"): VideoData | null {
  const ref = parseYouTubeUrl(url);
  if (!ref) return null;
  return { ...(ref.provider === "youtube" ? { provider: "youtube", videoId: ref.videoId } : { provider: "youtube_playlist", playlistId: ref.playlistId }), url: watchUrl(ref), title: title.trim().slice(0, 300) || "Video", whyWatch: whyWatch.trim().slice(0, 1000), reviewStatus };
}

export const CalloutDataSchema = z.object({
  variant: z.enum(["trap", "tip"]),
  title: text(300).default(""),
  content: text(20_000),
});
export type CalloutData = z.infer<typeof CalloutDataSchema>;

export const CheckpointDataSchema = z.object({
  title: text(300).default("Quick check"),
  instructions: text(2000).default(""),
  items: z
    .array(z.object({ id: text(40), prompt: text(4000), answer: text(4000), explanation: text(4000).default("") }))
    .min(1)
    .max(30),
});
export type CheckpointData = z.infer<typeof CheckpointDataSchema>;

/** The "Try it in Desmos" form of a Desmos block (from course packets): expressions loaded with setExpression. */
export const DesmosStepsSchema = z.object({
  title: text(300).default("Try it in Desmos"),
  useWhen: text(2000).default(""),
  steps: z.array(text(2000)).max(30).default([]),
  expressions: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), latex: text(2000) })).min(1).max(50),
  check: text(2000).default(""),
  watchOut: text(2000).default(""),
});
export type DesmosSteps = z.infer<typeof DesmosStepsSchema>;
export const isDesmosSteps = (d: unknown): d is DesmosSteps => DesmosStepsSchema.safeParse(d).success;
