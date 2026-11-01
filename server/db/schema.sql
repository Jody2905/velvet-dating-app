-- Velvet database schema (PostgreSQL 14+)
-- Run: psql "$DATABASE_URL" -f db/schema.sql

SET client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DROP TABLE IF EXISTS audit_log, messages, matches, likes, blocks, reports,
  review_cases, screening_results, verifications, profiles, users CASCADE;
DROP TYPE IF EXISTS user_role, account_status, verification_status,
  screening_outcome, case_status, case_severity CASCADE;

CREATE TYPE user_role           AS ENUM ('member', 'moderator');
-- pending: signed up, not yet cleared. active: visible. under_review: hidden while a moderator decides.
CREATE TYPE account_status      AS ENUM ('pending', 'active', 'under_review', 'suspended');
CREATE TYPE verification_status AS ENUM ('not_started', 'passed', 'failed');
CREATE TYPE screening_outcome   AS ENUM ('clear', 'possible_match');
CREATE TYPE case_status         AS ENUM ('open', 'recheck', 'suspended', 'cleared');
CREATE TYPE case_severity       AS ENUM ('low', 'medium', 'high');

-- Private identity. Legal name and DOB are never returned to other members.
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT UNIQUE,
  password_hash  TEXT NOT NULL,
  legal_name     TEXT NOT NULL,
  date_of_birth  DATE NOT NULL,
  role           user_role NOT NULL DEFAULT 'member',
  status         account_status NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT adult CHECK (date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'))
);

-- Public-facing profile.
CREATE TABLE profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  location     TEXT,
  bio          TEXT CHECK (char_length(bio) <= 500),
  interests    TEXT[] NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Result of ID + selfie verification. Images are NOT stored; only the provider's reference.
CREATE TABLE verifications (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id_document      verification_status NOT NULL DEFAULT 'not_started',
  selfie_liveness  verification_status NOT NULL DEFAULT 'not_started',
  provider         TEXT,
  provider_ref     TEXT,
  verified_at      TIMESTAMPTZ
);

-- One row per screening run (registries, watchlists, records).
CREATE TABLE screening_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_at     TIMESTAMPTZ NOT NULL,
  provider       TEXT NOT NULL,
  outcome        screening_outcome NOT NULL,
  hits           JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Anything a human must decide: screening hits and member reports.
CREATE TABLE review_cases (
  id             SERIAL PRIMARY KEY,
  subject_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source         TEXT NOT NULL,              -- e.g. 'screening:registry', 'report:Asked for money'
  severity       case_severity NOT NULL,
  details        JSONB NOT NULL DEFAULT '{}',-- field-by-field comparison, report text, etc.
  status         case_status NOT NULL DEFAULT 'open',
  decided_by     UUID REFERENCES users(id),
  decision_note  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);
CREATE INDEX review_cases_open ON review_cases (status, created_at) WHERE status IN ('open', 'recheck');

CREATE TABLE likes (
  liker_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  liked_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (liker_id, liked_id),
  CHECK (liker_id <> liked_id)
);

-- user_a < user_b so each pair is stored once.
CREATE TABLE matches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE messages (
  id           BIGSERIAL PRIMARY KEY,
  match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  safety_flag  TEXT,           -- e.g. 'money_request', 'contact_off_platform'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_by_match ON messages (match_id, created_at);

CREATE TABLE blocks (
  blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id          SERIAL PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  details     TEXT,
  case_id     INT REFERENCES review_cases(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit trail.
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID,
  action     TEXT NOT NULL,
  target_id  TEXT,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_log_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_readonly();
