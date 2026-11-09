/** Placeholder cover (a colour picked from the title) until real covers are rendered in Phase 2. */
function hue(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function CourseCover({ title }: { title: string }) {
  const h = hue(title);
  const initials = title.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      aria-hidden
      className="flex aspect-[3/4] w-full items-center justify-center rounded-lg text-lg font-bold sm:text-2xl text-white"
      style={{ background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 30%))` }}
    >
      {initials}
    </div>
  );
}
