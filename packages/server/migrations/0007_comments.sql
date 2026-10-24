-- Notes teammates leave on a shared session. Agents see them when they load the session.
CREATE TABLE session_comments (
  id          text PRIMARY KEY,
  session_id  text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  author_id   text NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX session_comments_session ON session_comments (session_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX session_comments_org_created ON session_comments (org_id, created_at DESC) WHERE deleted_at IS NULL;
