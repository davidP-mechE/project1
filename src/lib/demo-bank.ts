/**
 * Original practice questions for demo data only (the demo seed and demo
 * mode), so weekly practice, small groups and live warm-ups have published
 * bank questions to work with. Everything here is invented. The math is
 * generated; the Reading and Writing items are short, hand-written ones.
 * Ids start with the given prefix so the demo can remove them again.
 */

export type DemoBankQuestion = { externalId: string; section: "math" | "rw"; skillId: string; difficulty: number; stem: string; choices: string[]; answer: string; explanation: string };

const LETTERS = ["A", "B", "C", "D"];

/** Put the right answer at position `at`, the wrong ones around it. */
function place(right: string, wrong: string[], at: number) {
  const choices = [...wrong.slice(0, 3)];
  choices.splice(at % 4, 0, right);
  return { choices, answer: LETTERS[at % 4] };
}

const TRANSITIONS: [string, string, string[]][] = [
  ["The bridge was closed for repairs. ______, drivers took the longer river road.", "As a result,", ["For example,", "Similarly,", "In contrast,"]],
  ["Most of the garden's plants need full sun. ______, the ferns grow best in deep shade.", "However,", ["Therefore,", "Likewise,", "For instance,"]],
  ["The museum added evening hours. ______, it began offering free tours on Sundays.", "In addition,", ["Nevertheless,", "As a result,", "Instead,"]],
  ["Some birds migrate thousands of miles each year. ______, the arctic tern travels from pole to pole.", "For example,", ["However,", "Therefore,", "Meanwhile,"]],
  ["The team practiced every day for a month. ______, they won the regional final.", "Consequently,", ["Even so,", "Similarly,", "For example,"]],
  ["The first test of the robot failed. ______, the engineers kept improving the design.", "Even so,", ["Thus,", "For instance,", "Likewise,"]],
  ["Maple trees lose their leaves in autumn. ______, oak trees drop theirs as the days grow colder.", "Similarly,", ["However,", "As a result,", "Instead,"]],
  ["The town expected a small crowd at the fair. ______, more than five thousand people came.", "Instead,", ["Therefore,", "In addition,", "Similarly,"]],
];

const BOUNDARIES: [string, string, string[]][] = [
  ["The library opened in ______ it has been the busiest building in town ever since.", "1998;", ["1998,", "1998", "1998, and,"]],
  ["The chef needed three ______ flour, sugar, and butter.", "ingredients:", ["ingredients;", "ingredients,", "ingredients, such as:"]],
  ["Marisol finished her ______ then she helped her brother with his.", "homework, and", ["homework", "homework,", "homework; and,"]],
  ["The fossil, which was found near the ______ is now in a museum.", "river,", ["river", "river;", "river:"]],
  ["The storm knocked out the ______ the town used lanterns for two nights.", "power, so", ["power", "power,", "power so,"]],
  ["Our class visited the planetarium on ______ the show was about distant galaxies.", "Friday;", ["Friday,", "Friday", "Friday, and,"]],
  ["The recipe has one secret ______ a pinch of cinnamon.", "ingredient:", ["ingredient;", "ingredient", "ingredient, that is:"]],
  ["Jonah trained for months before the ______ he still finished an hour later than he hoped.", "race, yet", ["race", "race,", "race yet,"]],
];

export function demoBankQuestions(prefix: string): DemoBankQuestion[] {
  const out: DemoBankQuestion[] = [];
  for (let i = 0; i < 12; i++) {
    const a = 2 + (i % 5);
    const x = 1 + i;
    const b = 3 + 2 * i;
    const c = a * x + b;
    const p = place(String(x), [String(x + 1), String(x + 3), String(c - b)], i);
    out.push({ externalId: `${prefix}LIN-${i + 1}`, section: "math", skillId: "math.algebra.linear-equations-in-one-variable", difficulty: 1 + (i % 3), stem: `If $${a}x + ${b} = ${c}$, what is the value of $x$?`, ...p, explanation: `Subtract ${b} from both sides: $${a}x = ${c - b}$. Divide by ${a}: $x = ${x}$.` });
  }
  const PCT = [10, 15, 20, 25, 30, 40, 50, 60, 75, 5, 35, 45];
  for (let i = 0; i < 12; i++) {
    const pc = PCT[i];
    const n = 40 + 20 * i;
    const ans = (pc * n) / 100;
    const p = place(String(ans), [String(ans + n / 10), String(n - ans), String(pc + n)], i + 1);
    out.push({ externalId: `${prefix}PCT-${i + 1}`, section: "math", skillId: "math.psda.percentages", difficulty: 1 + (i % 3), stem: `What is ${pc}% of ${n}?`, ...p, explanation: `${pc}% means ${pc}/100, and ${pc}/100 × ${n} = ${ans}.` });
  }
  TRANSITIONS.forEach(([stem, right, wrong], i) => {
    const p = place(right, wrong, i + 2);
    out.push({ externalId: `${prefix}TRN-${i + 1}`, section: "rw", skillId: "rw.expression.transitions", difficulty: 1 + (i % 3), stem: `${stem}\n\nWhich choice completes the text with the most logical transition?`, ...p, explanation: `Compare the two sentences: "${right}" matches how the second relates to the first.` });
  });
  BOUNDARIES.forEach(([stem, right, wrong], i) => {
    const p = place(right, wrong, i + 3);
    out.push({ externalId: `${prefix}BND-${i + 1}`, section: "rw", skillId: "rw.conventions.boundaries", difficulty: 1 + (i % 3), stem: `${stem}\n\nWhich choice completes the text so that it conforms to the conventions of Standard English?`, ...p, explanation: `"${right}" is the only choice that joins the parts of the sentence correctly.` });
  });
  return out;
}
