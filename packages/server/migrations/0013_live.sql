-- Live sessions: teammates working at the same time opt in (/live), see each other's repo,
-- branch and files, and send messages that reach each other's agent between steps.

-- Whether people may let their agent act on teammates' messages without asking first.
ALTER TABLE org_settings ADD COLUMN live_autonomy boolean NOT NULL DEFAULT true;

CREATE TABLE live_sessions (
  id            text PRIMARY KEY,
  org_id        text NOT NULL,
  user_id       text NOT NULL,
  repo          text NOT NULL,
  branch        text,
  source_tool   text CHECK (source_tool IN ('claude-code', 'codex', 'opencode', 'zcode', 'gemini', 'copilot', 'cursor')),
  title         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT '',
  -- The owner lets their agent act on teammates' messages without asking.
  autonomy      boolean NOT NULL DEFAULT false,
  -- Messages up to this id have been taken by the agent (or the owner).
  read_upto     bigint NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX live_sessions_org_open ON live_sessions (org_id, repo) WHERE ended_at IS NULL;
CREATE INDEX live_sessions_user_open ON live_sessions (user_id) WHERE ended_at IS NULL;

CREATE TABLE live_messages (
  id            bigserial PRIMARY KEY,
  org_id        text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  to_live_id    text NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  from_live_id  text REFERENCES live_sessions(id) ON DELETE SET NULL,
  from_user_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_agent    boolean NOT NULL DEFAULT false,
  kind          text NOT NULL CHECK (kind IN ('message', 'question', 'answer')),
  body          text NOT NULL,
  reply_to      bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_messages_to ON live_messages (to_live_id, id);
CREATE INDEX live_messages_from ON live_messages (from_live_id, id);
CREATE INDEX live_messages_sender_created ON live_messages (from_user_id, created_at);

-- Files a live session touched recently (repo-relative), for overlap warnings.
CREATE TABLE live_files (
  live_id     text NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  path        text NOT NULL,
  touched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (live_id, path)
);
