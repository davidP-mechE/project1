-- Coach schema v1. Sensitive text (messages, episode records, session state) is
-- stored sealed (AES-256-GCM, see src/server/crypto.ts); only non-identifying
-- structure needed for limits and billing is stored in the clear.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  age_confirmed_at timestamptz,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'plus', 'advanced')),
  trial_ends_at timestamptz,
  country text NOT NULL DEFAULT 'US',
  memory_enabled boolean NOT NULL DEFAULT true,
  -- Separate, explicit consent; off by default (spec: never train without it).
  research_consent boolean NOT NULL DEFAULT false,
  off_limits text NOT NULL DEFAULT '',  -- sealed JSON array
  last_pattern_preview_at timestamptz,
  goals text NOT NULL DEFAULT ''        -- sealed JSON array of the user's own goals
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  state text NOT NULL,                  -- sealed SessionState
  crisis boolean NOT NULL DEFAULT false,
  pipeline_tier text NOT NULL DEFAULT 'free'
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body text NOT NULL,                   -- sealed
  trace text,                           -- sealed TurnTrace (assistant turns)
  move text,
  opener text,
  feedback smallint CHECK (feedback IN (-1, 1)),
  feedback_reason text,
  via_voice boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, id);
CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id, id DESC);

CREATE TABLE IF NOT EXISTS episodes (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  date date NOT NULL,
  record text NOT NULL,                 -- sealed Episode JSON
  -- Embedding for the similarity finder. pgvector in production; real[] works everywhere.
  vector real[],
  embedder text,
  has_confirmed boolean NOT NULL DEFAULT false,
  has_open_plan boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episodes_user ON episodes(user_id, date DESC);

CREATE TABLE IF NOT EXISTS patterns (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  wording text,                         -- sealed; the user's own rewording
  episode_ids text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS checkins (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('gets_me', 'wellbeing', 'insight')),
  score smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cost guardrails and per-user AI cost tracking (no content).
CREATE TABLE IF NOT EXISTS model_calls (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cost_microcents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_calls_user ON model_calls(user_id, created_at);

CREATE TABLE IF NOT EXISTS waitlist (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text
);

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
