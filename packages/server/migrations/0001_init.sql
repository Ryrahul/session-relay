-- Every tenant-owned row carries org_id. Self-hosted installs have one org;
-- the hosted version will have many, with no schema change.

CREATE TABLE orgs (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          text PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- Personal API tokens, scoped to one org. Only the SHA-256 hash is stored.
CREATE TABLE api_tokens (
  id            text PRIMARY KEY,
  org_id        text NOT NULL,
  user_id       text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE
);

-- Per-org settings instead of constants in code.
CREATE TABLE org_settings (
  org_id              text PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  retention_days      integer NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  repo_allowlist      text[] NOT NULL DEFAULT '{}',
  redaction_patterns  text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE sessions (
  id                   text PRIMARY KEY,
  org_id               text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  author_id            text NOT NULL REFERENCES users(id),
  source_tool          text NOT NULL CHECK (source_tool IN ('claude-code', 'codex', 'opencode')),
  source_version       text,
  native_id            text NOT NULL,
  repo                 text NOT NULL,
  branch               text,
  commit_sha           text,
  title                text NOT NULL,
  summary              jsonb NOT NULL,
  files_touched        text[] NOT NULL DEFAULT '{}',
  messages             jsonb NOT NULL DEFAULT '[]',
  include_mode         text NOT NULL CHECK (include_mode IN ('summary', 'summary+tail', 'full')),
  visibility_team      boolean NOT NULL DEFAULT true,
  redactions           integer NOT NULL DEFAULT 0,
  -- Full transcripts live in blob storage (local disk / S3 / R2), not here.
  transcript_key       text,
  transcript_bytes     bigint,
  started_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  deleted_at           timestamptz,
  search               tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(jsonb_to_tsvector('english', summary, '["string"]'), 'B') ||
    setweight(to_tsvector('simple', repo || ' ' || coalesce(branch, '')), 'B') ||
    setweight(jsonb_to_tsvector('english', messages, '["string"]'), 'D')
  ) STORED
);

CREATE INDEX sessions_org_repo_created ON sessions (org_id, repo, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX sessions_org_author_created ON sessions (org_id, author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX sessions_search ON sessions USING gin (search);

-- People a non-team share is visible to.
CREATE TABLE session_people (
  session_id  text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  org_id      text NOT NULL,
  user_id     text NOT NULL,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE
);

-- Metering, so usage can be reported or billed per org later.
CREATE TABLE usage_events (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     text,
  kind        text NOT NULL,
  bytes       bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_org_created ON usage_events (org_id, created_at);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     text,
  action      text NOT NULL,
  target_id   text,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_created ON audit_log (org_id, created_at DESC);
