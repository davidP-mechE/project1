# Coach (working name "Fathom")

A personal emotional-intelligence coach, built from `Product description.pdf`. You talk or type
about what happened; the app works out what you felt, tests why, and connects what keeps
repeating. It is a coach for self-understanding: not therapy, never diagnoses, not a crisis
service.

This folder is a self-contained app. It doesn't share code with the coursebook app in the rest of
the repository.

## What's here

This is the spec's "first tasks for developers" milestone plus a working web prototype of the
core experience.

| Spec section | Where it lives | Status |
|---|---|---|
| Episode record schema, state-machine stages as code | `src/engine/schema.ts`, `src/engine/stages.ts` | Done |
| Turn pipeline: safety → extractor → analyst → critic → voice | `src/engine/pipeline.ts` | Done |
| Investigation state machine (code decides; the model can't skip ahead) | `src/engine/stages.ts` | Done |
| Crisis screen on every message, localised help (US, CA, GB, AU) | `src/engine/safety.ts` | Done (keyword floor + model classifier) |
| Critic: banned phrases, diagnosis, overclaiming, sycophancy, one question, repetition | `src/engine/critic-rules.ts` + model critic | Done |
| Pattern recognition: structured counting + similarity clustering + evidence rules | `src/engine/patterns.ts`, `src/engine/embed.ts` | Done (offline embedder, see below) |
| Principle cards, system policy, labelled examples | `knowledge/` | 18 cards, 29 rules, 7 example conversations |
| Golden scenarios, safety set, simulated user, scoring, regression gate | `evals/`, `src/evals/harness.ts`, `scripts/eval.ts` | 50 scenarios, 102 safety cases |
| Claude-backed engine (pinned models, structured outputs, fallbacks) | `src/llm/claude-model.ts` | Written, not yet run (no API key here) |
| Screens: Talk, My patterns, History, Progress, Privacy & settings, help | `src/app/(app)/` | Done |
| Voice: tap- or hold-to-talk with editable live transcript | `src/components/use-speech.ts` | Browser speech recognition for now |
| Free / Plus / Advanced entitlements on the server, trial, cost caps | `src/engine/entitlements.ts`, `src/server/coach.ts` | Done (payments not wired) |
| Memory on/off, view, edit, export, delete everything | `src/app/api/me`, `export`, `episodes` | Done |
| Field-level encryption | `src/server/crypto.ts` | AES-256-GCM, single key (KMS later) |
| Waitlist landing page | `src/app/page.tsx` | Done |
| CI: typecheck, tests, eval gate, build | `.github/workflows/coach.yml` | Done |

## Running it

Needs Node 22 and Postgres 16.

```bash
cd coach
```

```bash
cp .env.example .env
```

Set `COACH_DATA_KEY` in `.env` (generate one with `openssl rand -base64 32`). Add an
`ANTHROPIC_API_KEY` to use the real engine.

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

The app runs on http://localhost:3100. Without an API key it runs the **offline engine**: a
deterministic, rule-based stand-in behind the same interface. It exists for development, tests
and the eval suite. It is much less capable than the real coach and must never be shipped to users.

## The two engines

`CoachModel` (`src/engine/model.ts`) is the single internal interface for every model call, as the
spec asks ("keep the pipeline model-agnostic").

- `ClaudeCoachModel`: `claude-opus-5-5` for the analyst, critic and voice, and `claude-haiku-5-5`
  for the safety pre-screen and extraction. Model IDs are pinned in env. Analysis calls use
  structured outputs validated against the zod schemas and retry once on an invalid reply. Main-model
  calls use server-side refusal fallbacks. Usage is logged per call for cost tracking.
  Current models don't accept a temperature setting, so consistency comes from structured outputs,
  low effort on analysis calls and the critic loop.
- `OfflineCoachModel`: regex extraction, appraisal/needs/CBT cause templates, templated voice.

Whichever engine runs, the state machine, the keyword crisis screen, the deterministic critic and
the pattern rules are the same code.

## Evals

```bash
npm run eval
```

```bash
npm run eval:gate
```

```bash
npm run eval -- --engine claude --sim llm --grade
```

The first runs the offline engine with a scripted simulated user. The second does the same and fails
if any gate fails (CI runs this). The third needs `ANTHROPIC_API_KEY` and adds the LLM simulated
user and grader.

The gate treats the safety thresholds as hard for every engine. For the offline engine, quality
metrics may not drop below `evals/baseline-offline.json`. For Claude, they're checked against the
launch thresholds.

Current offline results (50 scenarios, 102 safety cases):

| Measure | Target | Offline engine |
|---|---|---|
| Crisis detection recall | 100% | 100% |
| Premature conclusion rate | under 5% | 0% |
| Unsupported pattern rate | 0 | 0 |
| Diagnosis language per 100 replies | under 1 | 0 |
| Feeling identification | 85%+ | 83% (miss) |
| Expected cause in the engine's top 3 | 80%+ | 82% |
| Confirmed insight reached | — | 94% |

Read these with care:
- **The keyword crisis screen was tuned on the safety set.** The first run missed 29 of 57 crises.
  A held-out set written by the psychology advisor is needed before trusting the 100%.
- The scripted user answers whatever the coach asks, so these numbers measure the pipeline's
  logic, not real conversations. The LLM simulated user and human review are the real test.
- Scenarios, the safety set, cards and policy are drafts marked for advisor review.

## What's not done yet

Each of these needs a decision, a vendor or a person:

- **Run the Claude engine** with a key and tune prompts against the launch thresholds.
- **Psychology advisor sign-off** on cards, policy, scenarios and safety set; 150+ more golden
  scenarios and a held-out safety set.
- **Speech-to-text vendor**: the prototype uses browser speech recognition, which may send audio
  to the browser vendor. The spec's plan is to compare 2–3 streaming vendors on 30 accented
  recordings, with zero retention.
- **Embeddings**: `conceptEmbed` is an offline concept-lexicon vector. Swap in a hosted embedding
  model with a no-training agreement and move vectors to pgvector.
- **Auth**: anonymous signed-cookie accounts stand in for a managed provider (Clerk, Auth0 or
  Supabase Auth).
- **Payments**: RevenueCat + App Store / Play / Stripe webhooks writing the entitlement record.
  `POST /api/billing` is the seam.
- **KMS**: envelope encryption with per-user keys, so deleting a user also clears their backups.
- **Mobile app** (React Native + Expo), spoken replies (Advanced), weekly reports, background
  pattern worker (patterns are recomputed inline after each episode for now).
- **Encrypted model-call logs** for replay, product analytics without content, security review,
  pen test, privacy counsel review.

## Layout

```
coach/
  db/migrations/      SQL schema (sealed text columns)
  evals/              golden scenarios, safety set, offline baseline
  knowledge/          principle cards, policy, example conversations
  scripts/            migrate, eval
  src/engine/         the product's core, framework-free and unit-tested
  src/llm/            Claude engine, LLM simulated user and grader
  src/evals/          eval harness
  src/server/         storage, encryption, identity, orchestration
  src/app/            screens and API routes (Next.js 16)
  tests/              unit and integration tests
```
