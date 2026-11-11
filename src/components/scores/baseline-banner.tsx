import Link from "next/link";
import { baselineStatus } from "@/server/scores";

/** Students in a tutoring program are asked for a baseline score until they give one (or say they'll take the diagnostic). */
export async function BaselineBanner({ userId }: { userId: string }) {
  const s = await baselineStatus(userId);
  if (!s.needed || s.pending) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
      <span>
        <strong>Add your baseline SAT score.</strong> Your tutors measure your progress from it.
      </span>
      <Link href="/scores" className="font-semibold underline">
        Add it now
      </Link>
    </div>
  );
}
