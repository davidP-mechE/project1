"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live transcription for the prototype, via the browser's speech recognition.
 * The transcript lands in the text box so the user can fix a misheard word
 * before it's analysed (spec: the editable transcript is a reliability feature).
 * Production swaps this for the chosen streaming STT vendor (zero retention),
 * with raw audio deleted right after transcription.
 *
 * Tap to toggle; press and hold to talk, release to stop.
 */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const downAt = useRef(0);
  const wasListening = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    r.onerror = () => setListening(false);
    rec.current = r;
    setSupported(true);
  }, []);

  const startL = useCallback(() => {
    if (!rec.current || listening) return;
    try {
      rec.current.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, [listening]);
  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);
  const toggle = useCallback(() => (listening ? stop() : startL()), [listening, startL, stop]);

  return {
    supported,
    listening,
    interim,
    stop,
    toggle,
    pointerDown: () => {
      downAt.current = Date.now();
      wasListening.current = listening;
      if (!listening) startL();
    },
    pointerUp: () => {
      const held = Date.now() - downAt.current > 450;
      // A long press is hold-to-talk: release stops. A quick tap toggles.
      if (held || wasListening.current) stop();
    },
  };
}
