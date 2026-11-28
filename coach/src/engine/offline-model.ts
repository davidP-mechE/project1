import type { AnalystPlan, ExtractorOutput, Hypothesis, SafetyResult, ThinkingTrap } from "./schema";
import type { AnalystInput, CoachModel, ExtractInput, Turn, VoiceInput } from "./model";
import { detectFeelings, detectVagueWords } from "./emotions";
import { leader, missingSlots, rankHypotheses } from "./stages";
import { openerOf } from "./critic-rules";

/**
 * Offline engine: a deterministic, rule-based CoachModel.
 *
 * It exists so the app, the tests and the eval suite run without an API key and
 * give identical results every run. It is a floor, not the product: production
 * turns use the language model behind the same interface (ClaudeCoachModel).
 */

// ─── Extraction ─────────────────────────────────────────────────────────────

const RELATIONS: Record<string, string> = {
  friend: "social", friends: "social", roommate: "social", flatmate: "social", neighbour: "social", neighbor: "social",
  boss: "work", manager: "work", coworker: "work", "co-worker": "work", colleague: "work", team: "work", client: "work", teacher: "work",
  mum: "family", mom: "family", dad: "family", mother: "family", father: "family", sister: "family", brother: "family", parents: "family", son: "family", daughter: "family", grandma: "family", grandmother: "family", grandpa: "family", aunt: "family", uncle: "family", cousin: "family", "in-laws": "family",
  partner: "romance", boyfriend: "romance", girlfriend: "romance", husband: "romance", wife: "romance", ex: "romance", date: "romance",
};
const CONTEXT_CUES: [RegExp, string][] = [
  [/\b(work|office|meeting|standup|stand-up|deadline|project|presentation|promotion|review|shift|slide|job)\b/, "work"],
  [/\b(group chat|party|weekend plans|hang ?out|friends?|instagram|birthday)\b/, "social"],
  [/\b(family|christmas|thanksgiving|holiday|dinner at|my parents)\b/, "family"],
  [/\b(dating|date|relationship|anniversary|text back|break ?up)\b/, "romance"],
  [/\b(exam|class|school|uni|university|college|grade)\b/, "school"],
  [/\b(died|funeral|passed away|grief|anniversary of)\b/, "loss"],
  [/\b(money|rent|bills|debt)\b/, "money"],
  [/\b(sunday|monday morning)\b/, "routine"],
];
const EVENT_VERBS = /\b(said|says|told|made|didn'?t|did|asked|sent|saw|got|posted|cancell?ed|yelled|shouted|ignored|forgot|invited|left|decided|took|gave|called|texted|replied|criticis|criticiz|commented|announced|moved|lost|missed|snapped|laughed|interrupted|corrected|chose|picked|went|came|planned|happened|keeps?|kept|presented|praised|thanked|dumped|broke)\b/;
const NAME_STOP = new Set(["I", "I'm", "I've", "I'd", "I'll", "It", "The", "A", "And", "But", "So", "Then", "When", "My", "We", "He", "She", "They", "Just", "Yes", "No", "Yeah", "Ok", "Okay", "Maybe", "Honestly", "Instagram", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Christmas", "Thanksgiving", "Like", "That", "This", "What", "Not", "Well", "Also", "Because", "If", "Is", "Was", "Do", "Did", "Our", "Me", "Oh", "Hmm", "Actually", "Probably", "Nothing", "Everyone", "Nobody", "Sure", "Thanks", "Kind", "Partly", "Exactly", "Last", "Today", "Yesterday", "Now", "Still", "Even", "Then", "There"]);

const TRAPS: [ThinkingTrap, RegExp][] = [
  ["mind_reading", /\b(didn'?t (even )?think (about|of) me|doesn'?t care|don'?t care about me|(she|he|they) (must|probably) (think|hate|not care)|they think i'?m|wants? me gone|thinks? i'?m (stupid|useless|annoying|lazy)|doesn'?t (like|respect) me|no one cares)\b/],
  ["catastrophising", /\b(ruined|disaster|going to get fired|never (going to|gonna)|end of the world|everything is falling apart|it'?s over)\b/],
  ["all_or_nothing", /\b(always|never|everyone|nobody|no one|completely|totally useless|everything)\b/],
  ["should_statements", /\b(should(n'?t)? have|i should|they should|supposed to)\b/],
  ["labelling", /\b(i'?m (such )?(an idiot|a failure|stupid|pathetic|useless|a mess)|i'?m the worst)\b/],
  ["personalising", /\b(my fault|because of me|i caused|i ruin)\b/],
  ["overgeneralising", /\b(this always happens|every time|happens to me every)\b/],
];

/** "I worry about my mum" → "you worry about your mum" (for quoting a correction back). */
export const toSecondPerson = (t: string) =>
  t.replace(/\bI'm\b/g, "you're").replace(/\bI've\b/g, "you've").replace(/\bI'd\b/g, "you'd").replace(/\bI'll\b/g, "you'll").replace(/\bI\b/g, "you").replace(/\bmyself\b/gi, "yourself").replace(/\bmy\b/gi, "your").replace(/\bme\b/gi, "you").replace(/\bam\b/g, "are").replace(/[.!]+$/, "");

const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const askedAbout = (q: string | null, re: RegExp) => !!q && re.test(q.toLowerCase());

export function offlineExtract({ userText, state, lastAssistant }: ExtractInput): ExtractorOutput {
  const text = userText.trim();
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  const feelings = detectFeelings(text);
  const num = /\b(?:like a |about a |maybe a |an? |a )?(\d{1,2})(?:\s*(?:\/|out of)\s*10)?\b/.exec(lower);
  if (num && askedAbout(lastAssistant, /(1.?10|scale|how strong|intensity)/)) {
    const n = Math.min(10, Math.max(1, Number(num[1])));
    if (feelings.length) feelings[feelings.length - 1].intensity = n;
    else if (state.slots.feelings.length) feelings.push({ ...state.slots.feelings[state.slots.feelings.length - 1], intensity: n });
  }

  const people: string[] = [];
  const relRe = /\bmy (best )?(friend|friends|boss|manager|coworker|co-worker|colleague|mum|mom|dad|mother|father|sister|brother|parents|partner|boyfriend|girlfriend|husband|wife|ex|roommate|flatmate|son|daughter|grandma|grandmother|teacher|team|client|aunt|uncle|cousin|in-laws)\b(?:,?\s+([A-Za-z][a-z]+))?/gi;
  const contexts = new Set<string>();
  for (const m of text.matchAll(relRe)) {
    const rel = m[2].toLowerCase();
    const name = m[3] && /^[A-Z]/.test(m[3]) && !NAME_STOP.has(m[3]) ? m[3] : null;
    people.push(name ? `${rel}:${name}` : rel);
    contexts.add(RELATIONS[rel] ?? "social");
  }
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    const name = m[1];
    if (NAME_STOP.has(name) || people.some((p) => p.endsWith(`:${name}`))) continue;
    const before = text.slice(Math.max(0, m.index! - 2), m.index);
    if (m.index === 0 || /[.!?]\s*$/.test(before)) {
      // Sentence-initial capitals are only names when followed by a verb-ish word.
      if (!/^[A-Z][a-z]+\s+(said|told|made|didn'?t|did|asked|sent|posted|cancell?ed|yelled|ignored|forgot|invited|left|decided|took|called|texted|replied|is|was|has|keeps|never|always)\b/.test(text.slice(m.index))) continue;
    }
    people.push(name);
  }
  for (const [re, ctx] of CONTEXT_CUES) if (re.test(lower)) contexts.add(ctx);

  let plan: ExtractorOutput["plan_outcome"] = "none";
  if (askedAbout(lastAssistant, /(last time you planned|did you (end up|get to|try)|how did .* go|the plan)/)) {
    if (/\b(helped|worked|went (well|great|ok|okay)|it was good|glad i did|better)\b/.test(lower)) plan = "tried_helped";
    else if (/\b(didn'?t help|made it worse|went badly|didn'?t work|backfired)\b/.test(lower)) plan = "tried_didnt_help";
    else if (/\b(didn'?t|haven'?t|forgot|no time|not yet|chickened out|couldn'?t)\b/.test(lower) || /^no\b/.test(lower)) plan = "not_tried";
    else if (/\b(i did|yes|yeah|tried)\b/.test(lower)) plan = "tried_mixed";
  }

  const sents = sentences(text);
  let event: string | null = null;
  // A report on last time's plan isn't a new event.
  if (plan === "none" && (!state.slots.event || askedAbout(lastAssistant, /(what happened|most recent|what did (she|he|they) (do|say)|walk me through)/))) {
    const s = sents.find((x) => EVENT_VERBS.test(x.toLowerCase()) && x.split(/\s+/).length >= 4 && !/^(i feel|i'm feeling|i felt)\b/i.test(x));
    if (s) event = s.replace(/\s+/g, " ");
    else if (askedAbout(lastAssistant, /(what happened|most recent|walk me through|moment it)/) && text.split(/\s+/).length >= 4) event = (sents[0] ?? text).replace(/\s+/g, " ");
  }

  let interpretation: string | null = null;
  const interp = /\b(?:i thought|i think|i felt like|it (?:means|meant)|it'?s like|like (?:she|he|they|i)|made me feel like|as if|that (?:she|he|they) (?:don'?t|doesn'?t|didn'?t|must|probably)|i took it as|i took it to mean|i guess (?:she|he|they))\b([^.!?]*)/i.exec(text);
  if (interp) interpretation = text.slice(interp.index, interp.index + interp[0].length).trim();
  else if (askedAbout(lastAssistant, /(take it to mean|what did you make of|what went through your (head|mind)|tell yourself|what did that mean|what were you thinking)/)) interpretation = sents[0] ?? text;
  if (!interpretation) {
    const trapMatch = TRAPS.find(([t, re]) => t === "mind_reading" && re.test(lower));
    if (trapMatch) interpretation = sents.find((s) => trapMatch[1].test(s.toLowerCase())) ?? null;
  }

  let action: string | null = null;
  const act = /\bi (?:just )?(stopped|left|walked out|went quiet|didn'?t (?:reply|respond|say anything|answer)|said nothing|ignored|snapped|yelled|shouted|cried|withdrew|texted|called|replied|told|muted|blocked|apologi[sz]ed|pretended|agreed|said yes|went home|went to bed|stayed|avoided|kept quiet|laughed it off|vented|deleted|left the chat|left the group|cancell?ed)\b[^.!?]*/i.exec(text);
  if (act) action = act[0].trim();
  else if (!interpretation && askedAbout(lastAssistant, /(what did you do|how did you (respond|react)|what happened next|after that|on your side)/)) action = sents[0] ?? text;
  if (/^(nothing|not much|i did nothing)\b/i.test(text) && askedAbout(lastAssistant, /(what did you do|how did you (respond|react))/)) action = "Did nothing";

  const traps = TRAPS.filter(([, re]) => re.test(lower)).map(([t]) => t);

  let verdict: ExtractorOutput["verdict"] = "none";
  let correction: string | null = null;
  if (state.stage === "confirm" || state.pending_insight) {
    const more = /\b(?:more like|it'?s more (?:that|about)|actually it'?s|actually,? i think|it'?s really (?:that|about)|closer to)\s+([^.!?]+)/i.exec(text);
    if (more) correction = toSecondPerson(more[1].trim());
    if (/\b(partly|kind of|sort of|somewhat|a bit|in a way|maybe)\b/.test(lower) && !/\b(no|not)\b/.test(lower.split(/[,.]/)[0])) verdict = "partly";
    else if (/^(no|nope|nah|not really|not quite|not exactly|i don'?t think so)\b|\b(that'?s not it|not it|doesn'?t fit|that'?s wrong|you'?re wrong|not about that)\b/.test(lower)) verdict = "reject";
    else if (/^(yes|yeah|yep|yup|exactly|totally|definitely|absolutely|true|right|spot on|bang on|that'?s it|that'?s exactly|that fits|it fits|that'?s right|100)\b|\b(that'?s (exactly )?it|that fits|makes sense|nailed it|hits home|rings true)\b/.test(lower)) verdict = "confirm";
    if (verdict === "none" && more) verdict = "partly";
  }

  const offLimits = [...lower.matchAll(/\bdon'?t want to (?:talk|get into|go into) (?:about )?([^.!?,]+)/g)].map((m) => m[1].trim());
  const phrases = [...text.matchAll(/["“]([^"”]{3,40})["”]/g)].map((m) => m[1]);

  return {
    event,
    feelings,
    vague_feeling_words: detectVagueWords(text),
    interpretation,
    action_taken: action,
    people: [...new Set(people)],
    context: [...contexts],
    thinking_traps: traps,
    background_stress: /\b(already|exhausted|long week|no sleep|tired|on top of|stressful week)\b/.test(lower) ? sents.find((s) => /\b(already|exhausted|long week|no sleep|tired|on top of|stressful week)\b/i.test(s)) ?? null : null,
    verdict,
    correction,
    off_limits: offLimits,
    memorable_phrases: phrases,
    plan_outcome: plan,
    wants_to_end: /\b(gotta go|got to go|bye|that'?s all|good ?night|talk later|i'?m done for (today|now))\b/.test(lower),
  };
}

// ─── Hypotheses (appraisal / needs / CBT / chain analysis templates) ────────

type CauseTemplate = {
  key: string;
  method: Hypothesis["method"];
  cause: string;
  cues: RegExp;
  feelings: string[];
  traps?: ThinkingTrap[];
  supports: string;
  rules_out: string;
  /** A question that separates this cause from the others; and what a "yes" means. */
  probe: (who: string) => string;
  yesSupports: boolean;
  steps: (who: string) => string[];
  ifThen: (who: string) => string;
  contrast: string;
};

const CAUSES: CauseTemplate[] = [
  {
    key: "considered", method: "needs", cause: "you needed to feel considered, and this told you that you weren't",
    cues: /(without (me|asking|inviting|telling)|not invited|didn'?t (invite|ask|check|tell)|left out|excluded|decided|overlooked|ignored|forgot|plans|behind my back|found out|last minute|cancel)/,
    feelings: ["left out", "overlooked", "hurt", "disappointed", "embarrassed"], traps: ["mind_reading"],
    supports: "being left out of a decision, and reading it as not mattering", rules_out: "if being asked first wouldn't have changed how it felt",
    probe: (w) => `If ${w} had checked with you first and the outcome stayed exactly the same, would it still sting?`, yesSupports: false,
    steps: (w) => [`Ask ${w} directly what happened before deciding what it means.`, "Separate the fact (you weren't included) from the story (\"they don't care\")."],
    ifThen: (w) => `If I notice myself pulling back from ${w}, then I'll ask them about it before I decide what it means.`, contrast: "the plan itself",
  },
  {
    key: "inconvenience", method: "appraisal", cause: "the practical knock-on got in the way of something you wanted",
    cues: /(plans|schedule|had to|instead|cancel|moved|change|late|wait|extra work|dumped on|landed on me)/,
    feelings: ["irritated", "frustrated", "disappointed"],
    supports: "a goal of yours being blocked", rules_out: "if the practical cost was small and it still bothers you",
    probe: () => "If it had cost you nothing at all practically, would you still be bothered?", yesSupports: false,
    steps: () => ["Name the specific thing it got in the way of.", "Decide whether to ask for a change, or let this one go on purpose."],
    ifThen: () => "If something lands on me last minute, then I'll say what it costs me before agreeing.", contrast: "what it seemed to say about you",
  },
  {
    key: "standing", method: "appraisal", cause: "it made you worry about where you stand with them",
    cues: /(friend|partner|group|relationship|ghost|didn'?t reply|no reply|left on read|closer|drift|replace|rather|like me|want me)/,
    feelings: ["insecure", "anxious", "rejected", "hurt", "lonely", "jealous"], traps: ["mind_reading"],
    supports: "a fear about the relationship rather than this one event", rules_out: "if you feel secure with them otherwise",
    probe: (w) => `Apart from this, do you feel sure of where you stand with ${w}?`, yesSupports: false,
    steps: (w) => [`Notice what you're predicting about ${w}, and look for evidence for and against it.`, "Ask for reassurance directly instead of testing them."],
    ifThen: (w) => `If I start worrying about where I stand with ${w}, then I'll check one fact before I assume the worst.`, contrast: "this one event",
  },
  {
    key: "unappreciated", method: "needs", cause: "you needed your effort to be seen, and it wasn't",
    cues: /(credit|thank|appreciat|noticed|all the work|effort|took credit|presented my|my idea|my slide|nobody (noticed|said)|for granted)/,
    feelings: ["unappreciated", "resentful", "frustrated", "overlooked", "hurt"],
    supports: "work you did going unrecognised", rules_out: "if recognition wouldn't have changed how you feel",
    probe: (w) => `If ${w} had said out loud that it was your work, would that have settled it?`, yesSupports: true,
    steps: (w) => [`Tell ${w} plainly what you contributed and what you'd like next time.`, "Keep a short note of your contributions so you can point to them."],
    ifThen: (w) => `If my work gets presented without my name, then I'll speak up in the moment with one sentence about my part.`, contrast: "the work itself",
  },
  {
    key: "judged", method: "cbt_chain", cause: "you felt judged in front of others, and took it as a verdict on you",
    cues: /(in front of|everyone (saw|heard)|criticis|criticiz|comment|corrected|called me out|laughed|feedback|standup|meeting|publicly|embarrass)/,
    feelings: ["embarrassed", "humiliated", "ashamed", "self-conscious", "defensive", "angry"], traps: ["labelling", "mind_reading"],
    supports: "an audience, and a judgement you may have applied to yourself", rules_out: "if it would hurt just as much in private",
    probe: (w) => `If ${w} had said the exact same thing to you privately, would it have hit as hard?`, yesSupports: false,
    steps: () => ["Write down what was actually said, word for word, and what you told yourself it meant.", "Ask yourself what a fair colleague watching would have concluded."],
    ifThen: () => "If I feel called out in a group, then I'll ask a clarifying question instead of going quiet.", contrast: "the content of the comment",
  },
  {
    key: "unfair", method: "appraisal", cause: "it felt unfair, like the rules applied to you and not to them",
    cues: /(unfair|not fair|always me|my turn|double standard|favou?rite|get away with|no one else|why me|again)/,
    feelings: ["resentful", "angry", "frustrated", "irritated", "disrespected"], traps: ["all_or_nothing"],
    supports: "a sense of imbalance or a broken rule", rules_out: "if it happened evenly to everyone",
    probe: () => "If you found out it happens to everyone just as often, would it bother you less?", yesSupports: true,
    steps: () => ["Name the specific rule that feels broken, in one sentence.", "Decide whether to raise it as a request, not an accusation."],
    ifThen: () => "If it starts to feel one-sided again, then I'll name the imbalance with a specific example and a request.", contrast: "the event itself",
  },
  {
    key: "control", method: "appraisal", cause: "it left you feeling you had no say or control",
    cues: /(no say|no choice|told me (to|what)|made me|forced|micromanag|control|decided for me|can'?t do anything|out of my hands|nothing i can do)/,
    feelings: ["helpless", "frustrated", "angry", "overwhelmed", "anxious"],
    supports: "a decision or outcome taken out of your hands", rules_out: "if you had a real say and still feel this way",
    probe: () => "If you'd had a real say in it, even if the outcome was the same, would that have changed things?", yesSupports: true,
    steps: () => ["Sort what's in your control from what isn't, and pick one small thing in your control.", "Ask to be included earlier next time."],
    ifThen: () => "If a decision is made for me, then I'll ask to be part of the next one before I react.", contrast: "the outcome",
  },
  {
    key: "falling_short", method: "thinking_trap", cause: "it touched a fear that you're not good enough",
    cues: /(not good enough|failed|mistake|messed up|screwed up|behind|compare|better than me|promotion|grade|exam|should have|my fault|idiot|stupid)/,
    feelings: ["insecure", "anxious", "ashamed", "guilty", "discouraged", "jealous"], traps: ["labelling", "should_statements", "all_or_nothing"],
    supports: "self-judgement layered on top of the event", rules_out: "if you don't see it as saying anything about you",
    probe: () => "When you replay it, is the loudest thought about what happened, or about what it says about you?", yesSupports: false,
    steps: () => ["Write the harsh sentence you're telling yourself, then what you'd say to a friend in your place.", "Pick one specific thing to do differently next time, not a verdict on yourself."],
    ifThen: () => "If I catch myself calling myself a failure, then I'll name the specific mistake and one fix instead.", contrast: "the practical problem",
  },
  {
    key: "already_stretched", method: "chain_analysis", cause: "you were already running on empty, so this hit harder than it would have",
    cues: /(already|exhausted|tired|long week|no sleep|on top of|so much going on|overwhelm|busy|deadline)/,
    feelings: ["overwhelmed", "irritated", "frustrated", "anxious"],
    supports: "background stress lowering your threshold", rules_out: "if it would hurt just as much on a good, rested day",
    probe: () => "On a calm, well-rested day, would this have bothered you as much?", yesSupports: false,
    steps: () => ["Name what was already draining you before this happened.", "Protect one recovery block this week."],
    ifThen: () => "If I notice I'm snapping at small things, then I'll check how much I've got left before I respond.", contrast: "the trigger itself",
  },
  {
    key: "loss", method: "needs", cause: "underneath it is missing someone or something you've lost",
    cues: /(miss|died|passed|funeral|gone|used to|anniversary|grief|moved away|loss)/,
    feelings: ["grieving", "lonely", "melancholy", "hurt"],
    supports: "a loss being stirred up", rules_out: "if the loss doesn't come to mind at all",
    probe: () => "When this happened, did the person or thing you've lost come to mind?", yesSupports: true,
    steps: () => ["Give the missing a little deliberate space, like a short walk or a message to someone who knew them.", "Tell one person what today brought up."],
    ifThen: () => "If the missing hits out of nowhere, then I'll name it to myself and text one person who gets it.", contrast: "the surface event",
  },
  {
    key: "own_part", method: "cbt_chain", cause: "part of what's bothering you is your own part in how it went",
    cues: /(i snapped|i yelled|my fault|i should have|i said something|i shouldn'?t have|regret|guilty|i overreacted|i ignored)/,
    feelings: ["guilty", "ashamed", "embarrassed", "defensive"], traps: ["should_statements", "personalising"],
    supports: "regret about your own reaction", rules_out: "if you'd handle it the same way again",
    probe: () => "If you could replay it, would you handle your part differently?", yesSupports: true,
    steps: () => ["Name your part in one sentence, without the self-attack.", "Decide whether a short repair (an apology or a check-in) is worth making."],
    ifThen: () => "If I feel myself about to snap, then I'll say I need a minute and come back to it.", contrast: "what the other person did",
  },
];

function slotText(input: { state: AnalystInput["state"]; userText: string }) {
  const s = input.state.slots;
  return [s.event, s.interpretation, s.action_taken, s.background_stress, input.userText, ...s.feelings.map((f) => f.label)].filter(Boolean).join(" ").toLowerCase();
}

export function scoreCauses(input: { state: AnalystInput["state"]; userText: string }): { t: CauseTemplate; score: number }[] {
  const text = slotText(input);
  const feelings = input.state.slots.feelings.map((f) => f.label);
  const traps = input.state.slots.thinking_traps;
  return CAUSES.map((t) => {
    let score = (text.match(new RegExp(t.cues.source, "g")) ?? []).length * 1.5;
    score += t.feelings.filter((f) => feelings.includes(f)).length * 1.2;
    score += (t.traps ?? []).filter((x) => traps.includes(x)).length * 1;
    if (t.key === "already_stretched" && input.state.slots.background_stress) score += 1.5;
    return { t, score };
  }).sort((a, b) => b.score - a.score);
}

/** How to refer to the main person: second person in the coach's voice, first person in the user's plan. */
const who = (state: AnalystInput["state"], person: "you" | "me" = "you") => {
  const p = state.slots.people.find((x) => x.includes(":")) ?? state.slots.people[0];
  if (!p) return "them";
  const [rel, name] = p.split(":");
  if (name) return name;
  if (/^[A-Z]/.test(rel)) return rel;
  return `${person === "you" ? "your" : "my"} ${rel}`;
};

const templateOf = (h: Hypothesis) => CAUSES.find((t) => t.key === h.id.replace(/^h_/, ""));

function isYes(t: string) {
  return /^(yes|yeah|yep|yup|definitely|totally|absolutely|it would|it still would|probably yes|i think so|for sure|of course)\b|\b(still would|would still|it still would)\b/.test(t);
}
function isNo(t: string) {
  return /^(no|nope|nah|not really|honestly no|probably not|i don'?t think so|not at all|it wouldn'?t)\b|\b(wouldn'?t|would(?:'ve| have) been fine|that'?d be fine|that would be fine|don'?t (even )?care about)\b/.test(t);
}

// ─── Analyst ────────────────────────────────────────────────────────────────

const FEELING_SUGGESTIONS: Record<string, string[]> = {
  work: ["embarrassed", "frustrated", "anxious"],
  social: ["left out", "disappointed", "hurt"],
  family: ["guilty", "resentful", "hurt"],
  romance: ["rejected", "insecure", "lonely"],
  school: ["anxious", "discouraged", "embarrassed"],
  loss: ["grieving", "lonely", "numb"],
};

const pick = <T,>(xs: T[], seed: number) => xs[Math.abs(seed) % xs.length];
const seedOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

export function offlineAnalyse(input: AnalystInput): AnalystPlan {
  const { stage, state, userText, memory } = input;
  const seed = seedOf(userText) + input.ledger.replies.length;
  const w = who(state);
  const base: AnalystPlan = { hypotheses: [], move: "question", intent: "", question: null, probe_hypothesis_id: null, insight: null, coaching: null, references: [], principle_ids: [], hard_observation: false };

  if (stage === "intake" || stage === "clarify") {
    const missing = missingSlots(state.slots);
    // The user just reported on last time's plan: respond to that before anything else.
    const outcome = input.extraction.plan_outcome;
    if (outcome !== "none" && missing.includes("event")) {
      const q = {
        tried_helped: "You tried it and it helped. That's worth noticing: you did the thing instead of just thinking about it. What's on your mind today?",
        tried_mixed: "Mixed is still information. What part went the way you hoped, and what part didn't?",
        tried_didnt_help: "Thanks for being straight about that; we won't lean on that one again. What got in the way, or what happened instead?",
        not_tried: "That's fine, it's useful to know. What got in the way when the moment came?",
      }[outcome];
      return { ...base, move: "follow_up", intent: "Respond to the plan outcome and move on.", question: q, principle_ids: ["follow_up_plans"] };
    }
    const first = missing[0];
    const ctx = state.slots.context[0] ?? "";
    let q: string;
    const principle_ids = ["motivational_questions"];
    if (first === "event") {
      q = pick(["What's the most recent moment it showed up?", "Walk me through what happened, starting from the moment it began.", "What happened, right before you started feeling this way?"], seed);
      principle_ids.push("concrete_processing");
    } else if (first === "feeling") {
      const vague = state.vague_words_seen[0];
      const options = FEELING_SUGGESTIONS[ctx] ?? ["frustrated", "disappointed", "anxious"];
      q = vague
        ? `When you say ${vague}, is it closer to ${options[0]}, ${options[1]}, or ${options[2]}, or something else?`
        : pick([`What did you feel when it happened? Could be a mix, like ${options[0]} and a bit ${options[1]}.`, `If you had to put a word on the feeling, is it more ${options[0]}, ${options[1]}, or something else?`], seed);
      principle_ids.push("precise_labels");
    } else if (first === "interpretation") {
      q = pick(["When it happened, what did you take it to mean?", "What went through your head in that moment?", `What did you tell yourself about why ${w === "them" ? "it happened" : `${w} did that`}?`], seed);
      principle_ids.push("cbt_chain");
    } else {
      q = pick(["And what did you do after that?", "How did you respond in the moment?", "What happened next, on your side?"], seed);
      principle_ids.push("chain_analysis");
    }
    // Never ask the same question twice: if every phrasing for this slot was used, move on.
    const asked = input.history.filter((t) => t.role === "assistant").map((t) => t.text).concat(input.ledger.replies);
    if (asked.some((r) => r.includes(q))) {
      const alternatives: Record<string, string[]> = {
        event: ["Tell me the moment itself: who was there, and what was said?", "If you picture the moment it started, what's happening?"],
        feeling: ["Underneath it, is there something like hurt, worry or embarrassment?", "Where does it sit most: angry, sad, anxious, or something else?"],
        interpretation: ["What did it seem to say about you, or about them?", "What was the story your mind told about it?"],
        action: ["What did you end up doing with it?", "How did it play out afterwards?"],
      };
      const alt = alternatives[first]?.find((a) => !asked.some((r) => r.includes(a)));
      if (alt) q = alt;
    }
    const ref = memory.episodes.find((e) => state.slots.people.some((p) => e.people.includes(p)));
    return { ...base, move: "question", intent: `Fill the ${first} slot.`, question: q, principle_ids, references: ref ? [ref.episode_id] : [] };
  }

  if (stage === "hypothesise") {
    const rejected = state.hypotheses.filter((h) => h.confidence === "user_rejected").map((h) => h.id);
    const kept = state.hypotheses.filter((h) => h.confidence === "likely" && !rejected.includes(h.id));
    const ranked = scoreCauses(input).filter((x) => !rejected.includes(`h_${x.t.key}`));
    const fresh = ranked.slice(0, 3 - Math.min(kept.length, 1));
    const weights = [0.45, 0.35, 0.2];
    const hypotheses: Hypothesis[] = [
      ...kept.slice(0, 1).map((h) => ({ ...h, weight: 0.5 })),
      ...fresh.map((x, i) => ({ id: `h_${x.t.key}`, cause: x.t.cause, method: x.t.method, weight: weights[i + Math.min(kept.length, 1)] ?? 0.15, supports: x.t.supports, rules_out: x.t.rules_out, confidence: "unconfirmed" as const })),
    ];
    const probed = hypotheses.find((h) => templateOf(h));
    const q = probed ? templateOf(probed)!.probe(w) : "Which part of it is still bothering you most?";
    return { ...base, hypotheses, move: "question", intent: "Ask the question that best separates the top two explanations.", question: q, probe_hypothesis_id: probed?.id ?? null, principle_ids: ["appraisal_hypotheses", "needs_framing"] };
  }

  if (stage === "discriminate" || stage === "offer_insight" || stage === "confirm") {
    const hs = state.hypotheses.map((h) => ({ ...h }));
    const ranked = rankHypotheses(hs);
    const lower = userText.toLowerCase();
    if (stage === "discriminate" && ranked.length) {
      // Score the answer against the hypothesis the last question tested.
      const probed = hs.find((h) => h.id === state.last_probe) ?? ranked[0];
      const t = templateOf(probed);
      const yes = isYes(lower);
      const no = isNo(lower);
      if (t && (yes || no)) {
        const supports = yes === t.yesSupports;
        for (const h of hs) {
          if (h.confidence === "user_rejected") continue;
          if (h.id === probed.id) h.weight = supports ? Math.min(1, h.weight + 0.3) : Math.max(0, h.weight - 0.25);
          else h.weight = supports ? Math.max(0, h.weight - 0.1) : Math.min(1, h.weight + 0.15);
        }
      }
      // New words in the answer also count as evidence.
      const fresh = scoreCauses({ state: { ...state, slots: { ...state.slots, event: null, interpretation: null, action_taken: null, background_stress: null, feelings: [] } }, userText });
      for (const h of hs) {
        const s = fresh.find((x) => `h_${x.t.key}` === h.id)?.score ?? 0;
        if (s > 0 && h.confidence !== "user_rejected") h.weight = Math.min(1, h.weight + 0.08 * s);
      }
      // The user named the reason in their own words: follow them, as a hypothesis to put back to them.
      const own = /\b(?:honestly|really|actually|i think)?,?\s*it'?s (?:more |really )?(?:that|about|because) (.+)/i.exec(userText);
      if (own && own[1].split(/\s+/).length >= 3) {
        const cause = toSecondPerson(own[1].trim());
        for (const h of hs) if (h.confidence !== "user_rejected") h.weight = Math.min(h.weight, 0.35);
        hs.push({ id: `h_own${hs.length}`, cause, method: "needs", weight: 0.75, supports: "the user's own words", rules_out: "", confidence: "likely" });
      }
      for (const h of hs) if (h.confidence === "unconfirmed" && h.weight >= 0.5) h.confidence = "likely";
    }
    const lead = leader(hs);
    if ((stage === "discriminate" || stage === "offer_insight") && lead) {
      const t = templateOf(lead);
      const frames = t
        ? [`It might be less about ${t.contrast} and more that ${lead.cause}`, `Maybe what really got to you is that ${lead.cause}`, `One possibility: ${lead.cause}, more than ${t.contrast}`]
        : [`Maybe what's underneath it is that ${lead.cause}`, `It could be that ${lead.cause}`];
      const used = input.history.filter((x) => x.role === "assistant").map((x) => x.text.toLowerCase());
      const frame = frames.find((f) => !used.some((u) => u.includes(f.slice(0, 22).toLowerCase()))) ?? frames[frames.length - 1];
      const evidence = [state.slots.interpretation ? `you said "${trimQuote(state.slots.interpretation)}"` : null, state.slots.feelings.length ? `the feelings were ${state.slots.feelings.map((f) => f.label).join(" and ")}` : null].filter(Boolean).join(", and ");
      return {
        ...base,
        hypotheses: hs,
        move: "insight",
        intent: "Offer the leading explanation as a possibility with its evidence, and ask if it fits.",
        insight: { hypothesis_id: lead.id, statement: frame, evidence: evidence || lead.supports },
        principle_ids: ["insight_over_reflection"],
      };
    }
    if (stage === "confirm") {
      return { ...base, hypotheses: hs, move: "question", intent: "Ask plainly whether the insight fits.", question: "Is that close, or is it something else?", principle_ids: ["anti_sycophancy"] };
    }
    const r = rankHypotheses(hs);
    // Probe a hypothesis whose question hasn't been asked yet this session; never repeat one.
    const asked = input.history.filter((x) => x.role === "assistant").map((x) => x.text);
    const unasked = (q: string) => !asked.some((a) => a.includes(q));
    const nextH = r.find((h) => templateOf(h) && unasked(templateOf(h)!.probe(w)));
    const choiceQ = r.length >= 2 ? `Which is closer: ${r[0].cause}, or ${r[1].cause}?` : null;
    const openQ = "In your own words, what is it about this that gets to you most?";
    let q: string;
    let probe: string | null = null;
    if (nextH && state.stage_turns < 3) {
      q = templateOf(nextH)!.probe(w);
      probe = nextH.id;
    } else if (choiceQ && unasked(choiceQ)) q = choiceQ;
    else if (unasked(openQ)) q = openQ;
    else q = "What would have had to be different for this not to bother you?";
    return { ...base, hypotheses: hs, move: "question", intent: "Ask the next most discriminating question.", question: q, probe_hypothesis_id: probe, principle_ids: ["appraisal_hypotheses", "concrete_processing"] };
  }

  if (stage === "coach") {
    const confirmed = state.hypotheses.find((h) => h.confidence === "user_confirmed");
    const t = confirmed ? templateOf(confirmed) : undefined;
    const steps = t ? t.steps(w) : ["Write down the fact, then the story you told yourself about it.", "Check the story with one question before acting on it."];
    const filtered = steps.filter((s) => !memory.failedStrategies.some((f) => f.includes(s.slice(0, 30))));
    const traps = state.slots.thinking_traps;
    const finalSteps = (filtered.length ? filtered : steps).slice(0, traps.includes("mind_reading") ? 1 : 2);
    if (traps.includes("mind_reading") && !finalSteps.some((s) => /ask/i.test(s))) finalSteps.push(`Check the story with ${w} instead of guessing what they meant.`);
    return {
      ...base,
      hypotheses: state.hypotheses,
      move: "plan",
      intent: "Give one or two concrete steps and an if-then plan.",
      coaching: { steps: finalSteps.slice(0, 2), if_then: t ? t.ifThen(who(state, "me")) : "If this comes up again, then I'll pause and name the feeling before I respond." },
      principle_ids: ["if_then_plans", "practice_not_lecture"],
    };
  }

  // closed: the investigation is done.
  return { ...base, move: "question", intent: "Check whether there's anything else, without pressure.", question: pick(["Is there anything else on your mind, or is this a good place to stop?", "Anything else you want to look at, or is that enough for today?"], seed), principle_ids: [] };
}

const trimQuote = (s: string) => s.replace(/^(i thought|i think|i felt like)\s*/i, "").replace(/[.!?]+$/, "").slice(0, 80);

// ─── Voice ──────────────────────────────────────────────────────────────────

const ACKS: Record<string, string[]> = {
  question: ["Okay.", "Got it.", "Right.", "Mm, okay.", "That helps.", "Okay, that's useful."],
  insight: ["Here's what I'm noticing.", "Let me try something.", "Putting the pieces together:", "Here's one way to read it."],
  plan: ["Good, then let's make it usable.", "Then here's something concrete.", "Okay, so let's turn that into something you can do."],
};

export function offlineVoice(input: VoiceInput): string {
  const { plan, userText, recentlyUsed, feedback } = input;
  const seed = seedOf(userText) + feedback.length * 3;
  const tooLong = feedback.some((f) => f.startsWith("too long"));
  const choose = (xs: string[]) => {
    const ok = xs.filter((x) => !recentlyUsed.includes(openerOf(x)) && !feedback.some((f) => f.includes(`"${openerOf(x)}"`)));
    return ok.length ? pick(ok, seed) : "";
  };
  if (plan.insight) {
    const ack = tooLong ? "" : `${choose(ACKS.insight)} `.trimStart();
    const ev = plan.insight.evidence && !tooLong ? ` I'm going on this: ${plan.insight.evidence}.` : "";
    return `${ack}${plan.insight.statement}.${ev} Does that fit?`;
  }
  if (plan.coaching) {
    const ack = tooLong ? "" : `${choose(ACKS.plan)} `.trimStart();
    const steps = plan.coaching.steps.map((s, i) => (i === 0 ? s : `And ${s.charAt(0).toLowerCase()}${s.slice(1)}`)).join(" ");
    const it = plan.coaching.if_then ? ` As a plan: "${plan.coaching.if_then}" Want to put it in your own words?` : "";
    return `${ack}${steps}${it}`.trim();
  }
  const q = plan.question ?? "What feels most important to look at next?";
  const short = userText.trim().split(/\s+/).length <= 4;
  if (short || tooLong) return q;
  return `${choose(ACKS.question)} ${q}`.trim();
}

// ─── The model ──────────────────────────────────────────────────────────────

export class OfflineCoachModel implements CoachModel {
  readonly name = "offline-rules-v1";
  async safety(): Promise<SafetyResult | null> {
    return null;
  }
  async extract(input: ExtractInput) {
    return offlineExtract(input);
  }
  async analyse(input: AnalystInput) {
    return offlineAnalyse(input);
  }
  async voice(input: VoiceInput) {
    return offlineVoice(input);
  }
  async critique() {
    return null;
  }
}

export type { Turn };

/** For the deterministic simulated user: what a "yes" to each offline probe means. */
export const PROBE_YES_SUPPORTS: Record<string, boolean> = Object.fromEntries(CAUSES.map((c) => [`h_${c.key}`, c.yesSupports]));
export const CAUSE_KEYS = CAUSES.map((c) => c.key);
