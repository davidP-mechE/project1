import { getTutor } from "@/server/ai/client";
import { NotFoundError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";
import { workerQueryEmbedder } from "@/server/queue";
import { getSession } from "@/server/session";
import { askTutor, TutorError, type TutorEvent } from "@/server/tutor/chat";

// Answers stream for up to a minute or two.
export const maxDuration = 120;

/**
 * Ask the tutor a question. Streams newline-delimited JSON events:
 * meta (sources) → delta… (answer text) → done | error.
 * If the student stops it or leaves, the answer so far is saved as "stopped".
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  let body: { courseId?: unknown; threadId?: unknown; lessonId?: unknown; question?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);
  const courseId = str(body.courseId);
  if (!courseId) return jsonError("Invalid request.", 400);

  const encoder = new TextEncoder();
  const userId = session.user.id;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: TutorEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          /* the browser went away; the answer is still saved */
        }
      };
      try {
        await askTutor(userId, { courseId, threadId: str(body.threadId), lessonId: str(body.lessonId), question: body.question }, { tutor: getTutor(), embedder: workerQueryEmbedder }, emit, request.signal);
      } catch (err) {
        if (err instanceof TutorError) emit({ type: "error", message: err.message });
        else if (err instanceof NotFoundError) emit({ type: "error", message: "That course or conversation no longer exists." });
        else {
          console.error(err);
          emit({ type: "error", message: "Something went wrong. Please try again." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
