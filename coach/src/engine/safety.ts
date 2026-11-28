import type { SafetyResult } from "./schema";

/**
 * Crisis screen (spec: "Safety screen" + "Safety requirements").
 *
 * Runs on every message before anything else. The keyword screen is the floor:
 * it runs even when the model classifier is available, and either one flagging
 * a crisis is enough. False positives are acceptable here; misses are not.
 *
 * The phrase lists must be reviewed and extended by the psychology advisor.
 */

type Rule = { category: SafetyResult["category"]; patterns: RegExp[] };

const RULES: Rule[] = [
  {
    category: "suicide",
    patterns: [
      /\b(kill|killing)\s+my\s*self\b/,
      /\bsuicid(e|al)\b/,
      /\bend(ing)?\s+(it\s+all|my\s+life)\b|\bend(ing)?\s+(things|it)\b(?!\s+with\b)(?=\s*($|[.!,]|\s+(tonight|today|now|for\s+good|soon)))/,
      /\b(want|wanna|going)\s+to\s+die\b/,
      /\bwish\s+i\s+(was|were)\s+(dead|never\s+born)\b/,
      /\b(better\s+off|be\s+better)\s+without\s+me\b/,
      /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on|being\s+here)\b/,
      /\b(don'?t|do\s+not)\s+want\s+to\s+(be\s+here|wake\s+up|exist|live)\b/,
      /\bnot\s+(want|wanting)\s+to\s+(be\s+alive|live)\b/,
      /\b(can'?t|cannot)\s+(go\s+on|do\s+this\s+anymore|keep\s+going)\b/,
      /\bgoodbye\s+(note|letter)\b|\bsuicide\s+note\b/,
      /\b(took|taken|take)\s+(all\s+)?(my|the|a\s+bunch\s+of|too\s+many)\s+(pills|tablets)\b/,
      /\boverdos(e|ed|ing)\b/,
      /\bdisappear\s+forever\b/,
      /\bgiv(e|ing)\s+away\s+my\s+(stuff|things|belongings)\b/,
      /\bwon'?t\s+need\s+(it|them|my\s+\w+)\s+(anymore|much\s+longer)?\b.*|\bbecause\s+i\s+won'?t\s+need\b/,
      /\bpoint\s+of\s+(living|being\s+alive|going\s+on|life)\b/,
      /\blife\s+(isn'?t|is\s+not|isnt)\s+worth\b|\bnot\s+worth\s+living\b/,
      /\b(letters?|notes?)\s+to\s+my\s+(family|kids|parents|wife|husband|partner)\b.*\b(just\s+in\s+case|in\s+case|goodbye)\b/,
      /\b(pills?|tablets?)\s+saved\b|\bsaved\s+up\s+(pills|tablets)\b|\bhow\s+many\s+(pills|tablets)\b/,
      /\btonight'?s\s+the\s+night\b/,
      /\bnobody\s+would\s+(even\s+)?(notice|care|miss\s+me)\b.*\b(gone|dead|died|disappeared)\b|\b(if|when)\s+i\s+was\s+gone\b/,
      /\b(jump|jumping)\s+(off|from|in\s+front\s+of)\b/,
      /\bburden\s+to\s+(everyone|my\s+family|them|you|people)\b/,
      /\b(easier|better)\s+if\s+i\s+(wasn'?t|weren'?t|was\s+not)\s+(around|here|alive)\b/,
      /\bdriv(e|ing)\s+(my\s+car\s+)?(into|off)\s+(a|the)\s+(wall|tree|bridge|cliff|truck)\b/,
      /\bno\s+reason\s+(for\s+me\s+)?to\s+(keep\s+going|go\s+on|live|be\s+here)\b/,
      /\b(don'?t|do\s+not|can'?t)\s+see\s+(a|any)\s+future\b/,
      /\bjust\s+want\s+(it|everything|the\s+pain)\s+to\s+stop\b/,
      /\b(sleep|go\s+to\s+sleep)\s+and\s+never\s+wake\s+up\b/,
      /\bsaying\s+goodbye\b|\bthis\s+is\s+goodbye\b/,
      /\bwish\s+i'?d\s+never\s+been\s+born\b/,
      /\bbought\s+(a\s+)?(rope|gun|noose)\b/,
      /\bif\s+i\s+died\b.*\b(relieved|relief|good|better|fine)\b/,
      /\bnot\s+going\s+to\s+be\s+(around|here)\s+(much\s+)?(longer|for\s+long)\b/,
      /\bdon'?t\s+want\s+to\s+live\b|\bdont\s+want\s+to\s+live\b/,
    ],
  },
  {
    category: "self_harm",
    patterns: [
      /\b(hurt|harm|cut|cutting|burn|burning)\s+my\s*self\b/,
      /\bself[\s-]?harming\b/,
      /\bself[\s-]?harm/,
      /\bstarted\s+cutting\b|\bcutting\s+again\b/,
      /\bpunish\s+my\s*self\s+(physically|by\s+(hurting|not\s+eating|starving|cutting))\b/,
      /\b(hit|bang|banged|hitting|banging)\s+my\s+head\b.*\b(bled|bleed|blood|until)\b/,
      /\b(scratch|scratching|pick|picking)\s+(at\s+)?my\s+(arms|legs|skin)\b.*\b(bleed|bled|blood)\b/,
      /\b(on\s+purpose|deliberately)\b.*\b(hurt|harm|cut|burn)\b|\b(hurt|harm|cut|burn)\w*\s+my\s*self\s+on\s+purpose\b/,
      /\bnot\s+eating\s+for\s+days\b/,
    ],
  },
  {
    category: "abuse",
    patterns: [
      /\b(he|she|they|my\s+\w+)\s+(hits|hit|beats|beat|chokes|choked|strangled|kicks|kicked|slapped|slaps)\s+me\b/,
      /\bafraid\s+(for\s+my\s+(life|safety)|to\s+go\s+home|he'?ll\s+hurt|she'?ll\s+hurt)\b/,
      /\b(raped|sexually\s+assaulted|molested)\b/,
      /\bthreaten(ed|s)?\s+to\s+(kill|hurt)\s+me\b/,
      /\bwon'?t\s+let\s+me\s+leave\b/,
      /\b(pushed|shoved|threw)\s+me\s+(down|into|against|across)\b/,
      /\b(scared|afraid|terrified)\s+(he|she|they)('?ll|\s+will|\s+might)\s+hurt\s+me\b/,
      /\btakes?\s+my\s+(phone|money|keys|passport)\b/,
    ],
  },
  {
    category: "harm_to_others",
    patterns: [
      /\b(going|want|wanna)\s+to\s+(kill|hurt|stab|shoot)\s+(him|her|them|someone|my\s+(boss|partner|husband|wife|boyfriend|girlfriend|dad|mum|mom|brother|sister|roommate|ex|kids?|son|daughter|neighbou?r|coworker|colleague|friend|baby))\b/,
      /\bthinking\s+(about|of)\s+(killing|hurting)\s+(him|her|them|someone)\b/,
      /\bhurt\s+(the\s+|my\s+)?(baby|kids|child|children)\b/,
      /\b(killing|kill|hurt|hurting|shoot|shooting)\s+(my\s+)?\w+\b.*\b(actually|planning|plan|for\s+real|seriously)\b/,
      /\bshake\s+(the|my)\s+(baby|kids|child)\b/,
      /\b(gun|knife|weapon)\b.*\b(use\s+it\s+on|who\s+i'?m\s+going)\b/,
    ],
  },
  {
    category: "medical_emergency",
    patterns: [/\b(chest\s+pain|can'?t\s+breathe|having\s+a\s+stroke|heart\s+attack|seizure)\b/, /\b(too\s+much|too\s+many)\s+of\s+my\s+(medication|meds|pills)\b/],
  },
];

const DIAGNOSIS = [
  /\b(do\s+i|i)\s+(think\s+i\s+)?have\s+(anxiety|depression|adhd|ocd|ptsd|bpd|bipolar|autism|a\s+(disorder|personality\s+disorder|mental\s+illness))\b/,
  /\bis\s+(this|it)\s+(a\s+)?(ocd|adhd|ptsd|bpd|depression|anxiety|panic\s+disorder|panic\s+attack|bipolar|a\s+disorder)\b/,
  /\b(should\s+i|can\s+i)\s+(stop|start|come\s+off|quit)\s+(taking\s+)?(my\s+)?(meds|medication|antidepressants|ssris?|pills|sertraline|prozac|lexapro)\b/,
  /\bam\s+i\s+(depressed|bipolar|autistic|a\s+narcissist|mentally\s+ill)\b/,
  /\bdiagnos(e|is)\b/,
  /\bshould\s+i\s+(take|stop|start)\s+(my\s+)?(meds|medication|antidepressants|ssris?|pills)\b/,
  /\bwhat\s+(medication|meds|dose)\b/,
  /\bis\s+(he|she|my\s+\w+)\s+a\s+narcissist\b/,
];

export function keywordScreen(text: string): SafetyResult {
  const lower = text.toLowerCase().replace(/[’']/g, "'");
  for (const rule of RULES) {
    const hit = rule.patterns.find((p) => p.test(lower));
    if (hit) return { crisis: true, category: rule.category, wants_diagnosis: false, reason: `keyword: ${hit.source.slice(0, 40)}` };
  }
  const wantsDiagnosis = DIAGNOSIS.some((p) => p.test(lower));
  return { crisis: false, category: "none", wants_diagnosis: wantsDiagnosis, reason: wantsDiagnosis ? "keyword: diagnosis request" : "no keyword match" };
}

/** Either screen flagging a crisis wins; the keyword screen can never be overruled. */
export function mergeSafety(keyword: SafetyResult, model: SafetyResult | null): SafetyResult {
  if (keyword.crisis) return keyword;
  if (model?.crisis) return model;
  return {
    crisis: false,
    category: "none",
    wants_diagnosis: keyword.wants_diagnosis || (model?.wants_diagnosis ?? false),
    reason: model ? `${keyword.reason}; model: ${model.reason}` : keyword.reason,
  };
}

// ─── Human help, localised (spec: "Localise for each country at launch") ───

export type Resource = { name: string; contact: string; href: string };
export type CountryResources = { country: string; emergency: string; crisis: Resource[] };

export const RESOURCES: Record<string, CountryResources> = {
  US: {
    country: "United States",
    emergency: "911",
    crisis: [
      { name: "988 Suicide & Crisis Lifeline", contact: "Call or text 988", href: "tel:988" },
      { name: "Crisis Text Line", contact: "Text HOME to 741741", href: "sms:741741?body=HOME" },
      { name: "National Domestic Violence Hotline", contact: "Call 1-800-799-7233 or text START to 88788", href: "tel:18007997233" },
    ],
  },
  CA: {
    country: "Canada",
    emergency: "911",
    crisis: [{ name: "9-8-8 Suicide Crisis Helpline", contact: "Call or text 988", href: "tel:988" }],
  },
  GB: {
    country: "United Kingdom",
    emergency: "999",
    crisis: [
      { name: "Samaritans", contact: "Call 116 123", href: "tel:116123" },
      { name: "Shout", contact: "Text SHOUT to 85258", href: "sms:85258?body=SHOUT" },
    ],
  },
  AU: {
    country: "Australia",
    emergency: "000",
    crisis: [{ name: "Lifeline", contact: "Call 13 11 14", href: "tel:131114" }],
  },
};

export const resourcesFor = (country: string | null | undefined) => RESOURCES[(country ?? "US").toUpperCase()] ?? RESOURCES.US;

/**
 * The crisis reply is fixed text, not model-written: coaching stops, the reply is
 * warm and short, and human help comes first. Reviewed by the advisor, not generated.
 */
export function crisisReply(category: SafetyResult["category"], country?: string | null): string {
  const r = resourcesFor(country);
  const line = r.crisis[0];
  if (category === "abuse") {
    const dv = r.crisis.find((c) => /violence/i.test(c.name));
    return [
      "Thank you for telling me. What you're describing sounds frightening, and your safety matters more than anything we were talking about.",
      `If you're in danger right now, call ${r.emergency}.`,
      dv ? `${dv.name}: ${dv.contact}. They're confidential and can help you think through what's safe.` : `${line.name}: ${line.contact}.`,
      "I'm an AI, so I can't keep you safe the way a person can. Is there someone you trust who you could reach out to today?",
    ].join(" ");
  }
  if (category === "harm_to_others") {
    return [
      "I'm going to pause what we were doing, because what you just said matters more.",
      `If anyone is in immediate danger, call ${r.emergency}. ${line.name} also helps with thoughts of hurting someone else: ${line.contact}.`,
      "Talking to a person right now is the right next step. I'm an AI and can't be that support on my own.",
    ].join(" ");
  }
  if (category === "medical_emergency") {
    return `That sounds like it could be a medical emergency. Please call ${r.emergency} now, or ask someone near you to.`;
  }
  return [
    "I'm really glad you said that out loud. I'm going to stop the coaching here, because you deserve to talk with a person right now.",
    `${line.name}: ${line.contact}. It's free, confidential and open 24/7. If you're in immediate danger, call ${r.emergency}.`,
    "I'm an AI, so I can't be there the way a person can. Is there someone you could be with, or call, in the next little while?",
  ].join(" ");
}

export const DIAGNOSIS_REPLY =
  "I can't tell you whether you have a condition. I'm not able to diagnose anything, and it wouldn't be fair to you to guess. A doctor or licensed therapist can properly assess that, and it's worth asking one. What I can do is help you make sense of what you've been feeling and what sets it off. Want to start with the most recent time it hit?";
