/**
 * Granular emotion vocabulary (spec: "an emotion wheel with ~30–50 named feelings").
 * Each feeling belongs to a family and carries the words people use for it, so the
 * offline extractor can recognise it and the progress metric can count precision.
 *
 * Pending sign-off by the psychology advisor.
 */

export type Family = "sad" | "angry" | "afraid" | "ashamed" | "hurt" | "happy" | "calm" | "surprised" | "disgusted";

export type FeelingDef = { label: string; family: Family; cues: string[] };

export const FEELINGS: FeelingDef[] = [
  // sad
  { label: "disappointed", family: "sad", cues: ["disappointed", "let down", "letdown", "deflated"] },
  { label: "lonely", family: "sad", cues: ["lonely", "alone", "isolated"] },
  { label: "grieving", family: "sad", cues: ["grieving", "grief", "mourning", "miss her", "miss him", "passed away", "died"] },
  { label: "hopeless", family: "sad", cues: ["hopeless", "pointless", "no point"] },
  { label: "discouraged", family: "sad", cues: ["discouraged", "demoralised", "demoralized", "defeated"] },
  { label: "melancholy", family: "sad", cues: ["melancholy", "wistful", "blue"] },
  // hurt
  { label: "left out", family: "hurt", cues: ["left out", "excluded", "not invited", "without inviting", "without me", "uninvited"] },
  { label: "overlooked", family: "hurt", cues: ["overlooked", "ignored", "invisible", "unseen", "not noticed", "passed over"] },
  { label: "unappreciated", family: "hurt", cues: ["unappreciated", "taken for granted", "no thanks", "never thanked", "didn't thank"] },
  { label: "betrayed", family: "hurt", cues: ["betrayed", "backstabbed", "stabbed in the back", "went behind my back"] },
  { label: "rejected", family: "hurt", cues: ["rejected", "dumped", "turned down", "ghosted"] },
  { label: "hurt", family: "hurt", cues: ["hurt", "wounded", "stung"] },
  // angry
  { label: "irritated", family: "angry", cues: ["irritated", "annoyed", "irked", "bugged", "pissed"] },
  { label: "frustrated", family: "angry", cues: ["frustrated", "fed up", "exasperated"] },
  { label: "resentful", family: "angry", cues: ["resentful", "resent", "bitter"] },
  { label: "angry", family: "angry", cues: ["angry", "mad", "furious", "livid", "rage", "fuming"] },
  { label: "jealous", family: "angry", cues: ["jealous", "envious", "envy"] },
  { label: "disrespected", family: "angry", cues: ["disrespected", "disrespect", "talked down", "condescending", "patronised", "patronized"] },
  { label: "defensive", family: "angry", cues: ["defensive"] },
  // afraid
  { label: "anxious", family: "afraid", cues: ["anxious", "nervous", "on edge", "uneasy", "jittery"] },
  { label: "worried", family: "afraid", cues: ["worried", "worry", "concerned"] },
  { label: "overwhelmed", family: "afraid", cues: ["overwhelmed", "swamped", "drowning", "too much"] },
  { label: "insecure", family: "afraid", cues: ["insecure", "not good enough", "inadequate"] },
  { label: "dread", family: "afraid", cues: ["dread", "dreading"] },
  { label: "panicked", family: "afraid", cues: ["panicked", "panic", "freaking out", "freaked out"] },
  { label: "helpless", family: "afraid", cues: ["helpless", "powerless", "out of control", "no control"] },
  // ashamed
  { label: "embarrassed", family: "ashamed", cues: ["embarrassed", "awkward", "mortified", "cringe"] },
  { label: "ashamed", family: "ashamed", cues: ["ashamed", "shame"] },
  { label: "guilty", family: "ashamed", cues: ["guilty", "guilt", "my fault"] },
  { label: "humiliated", family: "ashamed", cues: ["humiliated", "humiliation"] },
  { label: "self-conscious", family: "ashamed", cues: ["self-conscious", "self conscious"] },
  // surprised / disgusted
  { label: "confused", family: "surprised", cues: ["confused", "don't understand", "baffled", "thrown"] },
  { label: "shocked", family: "surprised", cues: ["shocked", "blindsided", "stunned"] },
  { label: "disgusted", family: "disgusted", cues: ["disgusted", "grossed out", "revolted"] },
  { label: "contemptuous", family: "disgusted", cues: ["contempt", "can't stand"] },
  // positive (people bring good things too)
  { label: "relieved", family: "calm", cues: ["relieved", "relief"] },
  { label: "content", family: "calm", cues: ["content", "at peace", "settled"] },
  { label: "proud", family: "happy", cues: ["proud"] },
  { label: "grateful", family: "happy", cues: ["grateful", "thankful"] },
  { label: "hopeful", family: "happy", cues: ["hopeful", "optimistic"] },
  { label: "excited", family: "happy", cues: ["excited", "thrilled"] },
  { label: "connected", family: "happy", cues: ["connected", "close to"] },
];

/** Words that point at a feeling without naming one (spec: push past "bad" or "stressed"). */
export const VAGUE_WORDS = ["bad", "stressed", "upset", "off", "weird", "meh", "not great", "down", "fine", "whatever", "crap", "shit", "horrible", "awful", "terrible"];

const byLabel = new Map(FEELINGS.map((f) => [f.label, f]));
export const familyOf = (label: string): Family | null => byLabel.get(label.toLowerCase())?.family ?? null;
export const isKnownFeeling = (label: string) => byLabel.has(label.toLowerCase());

/** Rough intensity from modifiers near the cue ("really", "a little"). */
function intensityNear(text: string, index: number): number | null {
  const before = text.slice(Math.max(0, index - 24), index);
  if (/\b(extremely|incredibly|so so|really really|completely|totally)\s*$/.test(before)) return 9;
  if (/\b(really|so|very|super|pretty)\s*$/.test(before)) return 7;
  if (/\b(a (little|bit)|slightly|kind of|kinda|sort of|somewhat)\s*$/.test(before)) return 3;
  return null;
}

/** Offline feeling detection. Negation ("not angry") is skipped. */
export function detectFeelings(text: string): { label: string; intensity: number | null }[] {
  const lower = ` ${text.toLowerCase()} `;
  const out: { label: string; intensity: number | null }[] = [];
  for (const f of FEELINGS) {
    for (const cue of f.cues) {
      const re = new RegExp(`[^a-z]${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`);
      const m = re.exec(lower);
      if (!m) continue;
      const before = lower.slice(Math.max(0, m.index - 12), m.index + 1);
      if (/\b(not|n't|never|no longer)\s*(really\s*|that\s*)?$/.test(before)) continue;
      if (!out.some((o) => o.label === f.label)) out.push({ label: f.label, intensity: intensityNear(lower, m.index + 1) });
      break;
    }
  }
  return out;
}

export function detectVagueWords(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return VAGUE_WORDS.filter((w) => new RegExp(`(feel|feeling|felt|i'm|im|i am|was|just)\\s+(so\\s+|really\\s+|kind of\\s+|pretty\\s+)?${w}[^a-z]`).test(lower));
}

/** Precision score of one feeling word: named feelings 2, families/vague words 0–1. */
export function precisionOf(label: string): number {
  const l = label.toLowerCase();
  if (VAGUE_WORDS.includes(l)) return 0;
  if (["sad", "angry", "happy", "scared", "afraid"].includes(l)) return 1;
  return isKnownFeeling(l) ? 2 : 1;
}
