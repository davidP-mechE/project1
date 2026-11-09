/**
 * A small confetti burst from a point on the screen (e.g. the button that was
 * just clicked). Plain DOM, cleans itself up, and does nothing for people who
 * prefer reduced motion. Browser only: call it from event handlers.
 */
const COLORS = ["var(--primary)", "var(--success)", "var(--warning)", "#f472b6", "#60a5fa"];

export function burst(from: Element | { x: number; y: number } | null, opts: { count?: number; spread?: number } = {}) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const point =
    from && "getBoundingClientRect" in from
      ? (() => {
          const r = from.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      : (from ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 });
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden";
  const count = opts.count ?? 18;
  const spread = opts.spread ?? 90;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = spread * (0.6 + Math.random() * 0.6);
    p.style.cssText = `position:absolute;left:${point.x}px;top:${point.y}px;width:7px;height:9px;border-radius:2px;background:${COLORS[i % COLORS.length]};`;
    p.animate(
      [
        { transform: "translate(-50%,-50%) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist - 20}px)) scale(0.9) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * dist * 1.15}px), calc(-50% + ${Math.sin(angle) * dist + 60}px)) scale(0.6) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 300, easing: "cubic-bezier(0.2,0.8,0.3,1)", fill: "forwards" },
    );
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}
