/**
 * The 1600 Project's SAT curriculum maps (Reading & Writing, and Math), in the
 * form the tutor needs: the four scored domains of each section, their skills,
 * where each sits in the program's weeks, what to practise, and where good
 * practice comes from. Given to the tutor only, and only for SAT courses
 * (see isSatCourse), as a second, cached system block.
 *
 * It's for orientation and study advice, not a source of facts: the tutor
 * still answers content questions only from the course's own pages.
 */
export const SAT_CURRICULUM = `<sat_curriculum>
This course is part of an SAT program that follows the curriculum below. Use it to orient the student: which SAT domain and skill their question belongs to, how much that domain counts, where it sits in the program's weeks, what kind of practice builds it, and what to work on next. It is not a source of facts for answering content questions: those still come only from the passages.

READING AND WRITING: four scored domains
1. Information and Ideas (about 26% of the section). Can you locate, interpret and use information from a text or data? The foundation; taught first.
   - 1.1 Command of Evidence (textual), weeks 3–4: central ideas and details, using textual evidence, drawing inferences. Practise short passage sets with evidence pairs: a claim question, then "which quotation best supports this".
   - 1.2 Vocabulary in Context, weeks 5–6: words in context, precise word choice, connotation vs. denotation. Learn high-frequency SAT words inside passages, never as isolated word lists.
   - 1.3 Command of Evidence (quantitative) / data and graphics, weeks 21–22 (a late capstone, once reading stamina is built): graphs, tables and charts inside reading passages. Practise passage-plus-graphic questions.
2. Craft and Structure (about 28%). How and why a text is built the way it is; conceptually the hardest domain, so it gets the longest runway (weeks 5–8).
   - 2.1 Words in Context (rhetorical use), weeks 5–6 with 1.2: why the author chose a word ("the author's use of the word X primarily serves to...").
   - 2.2 Text Structure and Purpose, weeks 7–8: author's purpose, structure of a passage. Practise purpose identification and structure mapping.
   - 2.3 Cross-Text Connections, weeks 7–8: comparing and synthesizing two related passages. Practise paired-passage sets.
3. Expression of Ideas (about 20%). Rhetorical choices, not grammar rules: what to include, cut or reorder. Best after strong reading comprehension.
   - 3.1 Rhetorical Synthesis, weeks 9–10: turn bullet-point notes into a claim that meets a stated goal. Formulaic once the pattern is learned (read the goal first, pick the option that does exactly that, using only the notes); timed drills; high return on effort.
   - 3.2 Transitions, weeks 9–10: the logical relationship between sentences (contrast, cause and effect, addition, example...). Name the relationship first, then pick the word.
   - 3.3 Effective Language Use / Conciseness, weeks 9–10: precise word choice, cutting redundancy; "which version is most concise while keeping the meaning".
4. Standard English Conventions (about 26%). Grammar and mechanics: the most rules-based domain and the fastest to improve with direct instruction.
   - 4.1 Conventions I, sentence structure, weeks 11–12: sentence boundaries (run-ons, fragments), subordination and coordination, punctuation.
   - 4.2 Conventions II, agreement and usage, weeks 13–14: subject–verb and pronoun–antecedent agreement, pronoun clarity, modifier placement, apostrophes and possessives.
Integration thread (Unit 9): timed, full-length mixed-domain sets through weeks 15–30 (for example one every Friday) to build stamina and domain-switching speed; weeks 23–30 are full timed simulations.

MATH: four scored domains
1. Algebra (about 35% of the section). Linear thinking, equations and inequalities; taught first.
   - 1.1 Linear Equations and Systems, weeks 3–4: solving and graphing linear equations, systems, linear inequalities. Practise translating word problems into linear models; graph systems in Desmos, the calculator built into the digital SAT.
2. Advanced Math (about 35%, the largest domain, so the longest runway).
   - 2.1 Quadratics and Functions, weeks 7–9: factoring, the quadratic formula, function notation and transformations. Practise graph-to-equation and equation-to-graph; check roots and vertices in Desmos.
   - 2.2 Exponents and Exponential Models, weeks 10–11: exponent rules, growth and decay, radicals. Practise real-world growth and decay problems.
3. Problem-Solving and Data Analysis (about 15%). Applied math; lower weight but frequent.
   - 3.1 Ratios, Rates and Percentages, weeks 5–6: proportional relationships, unit conversion, percent change, in applied word problems.
   - 3.2 Statistics and Probability, weeks 12–14: mean, median, mode, standard deviation concepts, probability, inference from samples and study design.
   - 3.3 Data and Graph Interpretation, weeks 21–22 (capstone): reasoning from graphs, tables and scatterplots.
4. Geometry and Trigonometry (about 15%). The smallest domain but often the rustiest.
   - 4.1 Geometry and Trigonometry, weeks 15–17: area and volume, circles, right-triangle trigonometry, unit-circle basics; multi-step geometric reasoning. The test gives a reference sheet of geometry formulas, so practise with it and know what is and isn't on it.
Integration thread (Unit 7), weeks 18–20 and beyond: timed, cross-domain, calculator-allowed sets, plus when Desmos saves time and when mental math or solving by hand is faster.

WHERE PRACTICE COMES FROM (suggest these by name when a student asks what to practise; you can't open them)
- College Board's SAT Suite Question Bank: filter by domain and skill; written by the test maker, the best source for every domain, and the deepest for Cross-Text Connections and Rhetorical Synthesis.
- Bluebook: official full-length digital practice tests; best saved for end-of-unit or full timed practice, since there are only a few.
- Khan Academy's free Official SAT Practice: short lessons and practice aligned to the digital SAT.
- Desmos: practise with the same graphing calculator the test uses.

HOW TO USE THIS
- When it helps, name the domain and skill a question belongs to (for example "This is a Transitions question, part of Expression of Ideas") and the method for that question type.
- If the student asks what to study or where they are, use the weeks and weights above; favour high-weight domains (Craft and Structure in Reading and Writing; Algebra and Advanced Math in Math) and high-return units like Rhetorical Synthesis and Conventions.
- Don't invent scores, dates or official statistics beyond the approximate weights above.
</sat_curriculum>`;

/** Whether a course is SAT prep: its title, the Hub course it came from, or its class's program says so. */
export function looksLikeSat(input: { title: string; catalogTitle?: string | null; programSubject?: string | null }): boolean {
  if (input.programSubject?.toUpperCase() === "SAT") return true;
  return [input.title, input.catalogTitle ?? ""].some((t) => /\b(P?SAT)\b/.test(t));
}
