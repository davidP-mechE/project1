import { formatInZone } from "@/lib/dates";

type B = { id: string; kind: string; label: string; how: string; earnedAt: Date };

const GLYPH: Record<string, string> = {
  STREAK_5: "5",
  STREAK_10: "10",
  STREAK_30: "30",
  MISTAKES_CLEARED: "✓",
  DOMAIN_MASTERED: "★",
  FIRST_DIAGNOSTIC: "D",
  GAIN_100: "+1",
  GAIN_200: "+2",
  PERFECT_ATTENDANCE: "●",
};

/** Earned badges as small gold medallions. Only ever the student's own (no rankings). */
export function BadgeList({ badges, zone, empty }: { badges: B[]; zone: string; empty?: string }) {
  if (!badges.length) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {badges.map((b) => (
        <li key={b.id} className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-sm" title={b.how}>
          <span aria-hidden className="score-num flex size-8 items-center justify-center rounded-full border-2 border-accent bg-primary text-xs text-primary-text dark:bg-surface-2 dark:text-accent-ink">
            {GLYPH[b.kind] ?? "★"}
          </span>
          <span>
            <span className="font-medium">{b.label}</span>
            <span className="block text-xs text-muted">{formatInZone(b.earnedAt, zone, "medium")}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
