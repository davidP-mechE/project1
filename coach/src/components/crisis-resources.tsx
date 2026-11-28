"use client";
import { useEffect, useRef } from "react";
import type { Resources } from "@/lib/api";

export function CrisisResources({ resources, focus }: { resources: Resources; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center" });
  }, [focus]);
  return (
    <div ref={ref} className="note help" role="region" aria-label="Talk to a person now">
      <p style={{ margin: 0, fontWeight: 600 }}>Talk to a person now</p>
      <ul className="resources">
        {resources.crisis.map((r) => (
          <li key={r.name}>
            <a href={r.href}>{r.name}</a> <span className="muted">{r.contact}</span>
          </li>
        ))}
        <li>
          <a href={`tel:${resources.emergency}`}>Emergency services</a> <span className="muted">Call {resources.emergency} if you or someone else is in immediate danger</span>
        </li>
      </ul>
    </div>
  );
}
