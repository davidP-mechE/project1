"use client";

import { useEffect } from "react";
import { studyHeartbeatAction } from "@/server/actions/progress";

/**
 * Counts study time for the daily goal: once a minute, while this page is
 * visible and you've interacted with it in the last 2 minutes, adds a minute.
 * (The server ignores extra beats from other open tabs.)
 */
export function StudyTimer() {
  useEffect(() => {
    let lastInput = Date.now();
    const touch = () => (lastInput = Date.now());
    const events = ["pointerdown", "keydown", "scroll", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastInput < 120_000) void studyHeartbeatAction().catch(() => {});
    }, 60_000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, []);
  return null;
}
