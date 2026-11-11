import "server-only";
import { db } from "./db";
import { ClassError, classAccess, memberWhere, type ClassAccess } from "./access";
import { addScore, staffForStudent } from "./scores";
import { domainTally } from "./pacing";
import { audit } from "./programs";
import { DOMAINS, domainById, domainName } from "@/lib/sat/domains";
import { rankDomains, readScoreReports, type DomainEvidence, type ReviewQuestion } from "@/lib/sat/cb-import";

/**
 * College Board results in the site: importing a class's score reports, and
 * pinpointing each student's weak spots from everything known about them
 * (College Board score-report bands, College Board question reviews, and
 * work done in the site). See src/lib/sat/cb-import.ts for the formats.
 */

const sectionVisible = (a: ClassAccess | null, domain: string) => !a?.subjects || a.subjects.has(domain);

// ─── Class import ────────────────────────────────────────────────────────

export type ImportPreviewRow = { line: number; email: string; name: string | null; test: string; total: number; status: "ready" | "error" | "not in class" | "already added"; notes: string[] };

/** Check a class spreadsheet of score reports, and (unless `dryRun`) add the good rows. */
export async function importScoreReports(actorId: string, classId: string, text: string, opts: { dryRun?: boolean } = {}, now = new Date()) {
  const access = await classAccess(actorId, classId, "teach");
  if (text.length > 500_000) throw new ClassError("That file is too big. Split it into smaller ones.");
  const { rows, error, ignoredColumns } = readScoreReports(text);
  if (error) throw new ClassError(error);
  if (rows.length > 300) throw new ClassError("Up to 300 rows at a time.");
  const members = await db.classMember.findMany({ where: memberWhere(access), select: { user: { select: { id: true, email: true, name: true } } } });
  const byEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user]));
  const out: ImportPreviewRow[] = [];
  let added = 0;
  for (const r of rows) {
    const student = byEmail.get(r.email);
    const notes = [...r.errors];
    let status: ImportPreviewRow["status"] = notes.length ? "error" : "ready";
    if (!notes.length && !student) status = "not in class";
    // Bands outside a subject-limited person's subjects are left out, and said so.
    const bands = Object.fromEntries(Object.entries(r.bands).filter(([d]) => sectionVisible(access, d)));
    const dropped = Object.keys(r.bands).length - Object.keys(bands).length;
    if (dropped) notes.push(`${dropped} domain ${dropped === 1 ? "band" : "bands"} outside your subjects left out`);
    if (status === "ready" && student) {
      const dup = await db.scoreRecord.count({ where: { studentId: student.id, source: r.source, takenOn: new Date(`${r.takenOn}T00:00:00Z`), total: r.total } });
      if (dup) status = "already added";
    }
    if (status === "ready" && student && !opts.dryRun) {
      try {
        await addScore(actorId, student.id, { source: r.source, takenOn: `${r.takenOn}T00:00:00Z`, testName: r.testName ?? undefined, total: r.total, rw: r.rw, math: r.math, domainBands: bands }, { classId }, now);
        added++;
      } catch (err) {
        status = "error";
        notes.push(err instanceof Error ? err.message : "Couldn't add it");
      }
    }
    out.push({ line: r.line, email: r.email, name: student?.name ?? null, test: r.testName ?? r.source, total: r.total, status, notes });
  }
  if (!opts.dryRun && added) await audit(db, { programId: access.programId, actorId, action: "score.import", targetType: "class", targetId: classId, summary: `Imported ${added} College Board score report${added === 1 ? "" : "s"}` });
  return { rows: out, added, ignoredColumns };
}

// ─── Weak spots ──────────────────────────────────────────────────────────

const YEAR = 365 * 86_400_000;

/** The evidence per domain for one student, limited to the viewer's subjects. */
async function evidenceFor(studentId: string, access: ClassAccess | null, now: Date) {
  const [scores, tally, mistakes, wrongBySkill] = await Promise.all([
    db.scoreRecord.findMany({ where: { studentId, takenOn: { gte: new Date(now.getTime() - YEAR) } }, orderBy: { takenOn: "desc" }, select: { takenOn: true, testName: true, source: true, domainBands: true, review: true } }),
    domainTally(studentId, 90, now),
    db.mistakeItem.groupBy({ by: ["domain"], where: { studentId, retiredAt: null }, _count: { _all: true } }),
    db.assignmentAnswer.findMany({ where: { userId: studentId, correct: false, createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) }, item: { skill: { not: null } } }, select: { item: { select: { skill: true, domain: true } } } }),
  ]);
  const band = new Map<string, { band: number; from: string }>();
  const cb = new Map<string, { right: number; total: number }>();
  const skills = new Map<string, { domain: string; missed: number; seen: number }>();
  for (const s of scores) {
    const bands = (s.domainBands ?? {}) as Record<string, number>;
    for (const [d, b] of Object.entries(bands)) if (!band.has(d)) band.set(d, { band: b, from: s.testName || s.source });
    for (const q of (Array.isArray(s.review) ? s.review : []) as ReviewQuestion[]) {
      const t = cb.get(q.domain) ?? { right: 0, total: 0 };
      t.total++;
      if (q.correct) t.right++;
      cb.set(q.domain, t);
      if (q.skill) {
        const k = skills.get(q.skill) ?? { domain: q.domain, missed: 0, seen: 0 };
        k.seen++;
        if (!q.correct) k.missed++;
        skills.set(q.skill, k);
      }
    }
  }
  for (const w of wrongBySkill) {
    if (!w.item.skill || !w.item.domain) continue;
    const k = skills.get(w.item.skill) ?? { domain: w.item.domain, missed: 0, seen: 0 };
    k.missed++;
    k.seen++;
    skills.set(w.item.skill, k);
  }
  const open = new Map(mistakes.map((m) => [m.domain ?? "", m._count._all]));
  const evidence: DomainEvidence[] = DOMAINS.filter((d) => sectionVisible(access, d.id)).map((d) => ({
    domain: d.id,
    band: band.get(d.id)?.band ?? null,
    cbRight: cb.get(d.id)?.right ?? 0,
    cbTotal: cb.get(d.id)?.total ?? 0,
    siteAccuracy: tally.get(d.id) ? tally.get(d.id)!.sum / tally.get(d.id)!.n : null,
    siteAnswers: tally.get(d.id)?.n ?? 0,
    openMistakes: open.get(d.id) ?? 0,
  }));
  const ranked = rankDomains(evidence).map((e) => ({ ...e, name: domainName(e.domain), section: domainById(e.domain)!.section, bandFrom: band.get(e.domain)?.from ?? null }));
  const topSkills = [...skills.entries()]
    .filter(([, k]) => sectionVisible(access, k.domain) && k.missed > 0)
    .sort((a, b) => b[1].missed - a[1].missed || b[1].missed / b[1].seen - a[1].missed / a[1].seen)
    .slice(0, 6)
    .map(([skill, k]) => ({ skill, domain: k.domain, domainName: domainName(k.domain), missed: k.missed, seen: k.seen }));
  const sources = { reports: scores.filter((s) => Object.keys((s.domainBands ?? {}) as object).length).length, reviews: scores.filter((s) => Array.isArray(s.review) && s.review.length).length };
  return { domains: ranked, skills: topSkills, sources };
}

/** A student's own weak spots. */
export async function myWeakSpots(userId: string, now = new Date()) {
  return evidenceFor(userId, null, now);
}

/** A student's weak spots for staff in scope (their subjects only). */
export async function studentWeakSpots(actorId: string, classId: string, studentId: string, now = new Date()) {
  const access = await staffForStudent(actorId, classId, studentId, "view");
  return evidenceFor(studentId, access, now);
}

/** Across the class (in scope): how many students have each domain among their two weakest, and the average band. */
export async function classWeakSpots(actorId: string, classId: string, now = new Date()) {
  const access = await classAccess(actorId, classId, "view");
  const members = await db.classMember.findMany({ where: memberWhere(access), select: { userId: true } });
  const counts = new Map<string, { weakest: number; bands: number[] }>();
  let withEvidence = 0;
  for (const m of members) {
    const e = await evidenceFor(m.userId, access, now);
    const known = e.domains.filter((d) => d.strength !== null);
    if (known.length) withEvidence++;
    known.slice(0, 2).forEach((d) => counts.set(d.domain, { ...(counts.get(d.domain) ?? { weakest: 0, bands: [] }), weakest: (counts.get(d.domain)?.weakest ?? 0) + 1 }));
    for (const d of e.domains) if (d.band !== null) counts.set(d.domain, { ...(counts.get(d.domain) ?? { weakest: 0, bands: [] }), bands: [...(counts.get(d.domain)?.bands ?? []), d.band] });
  }
  const rows = DOMAINS.filter((d) => sectionVisible(access, d.id))
    .map((d) => {
      const c = counts.get(d.id);
      return { domain: d.id, name: d.name, section: d.section, weakestFor: c?.weakest ?? 0, averageBand: c?.bands.length ? Math.round((c.bands.reduce((a, b) => a + b, 0) / c.bands.length) * 10) / 10 : null, bandCount: c?.bands.length ?? 0 };
    })
    .sort((a, b) => b.weakestFor - a.weakestFor || (a.averageBand ?? 8) - (b.averageBand ?? 8));
  return { students: members.length, withEvidence, rows };
}
