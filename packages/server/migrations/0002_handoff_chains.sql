-- A share can continue another session (someone ran /pickup, then /share).
ALTER TABLE sessions
  ADD COLUMN continues_session_id text REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX sessions_continues ON sessions (org_id, continues_session_id) WHERE continues_session_id IS NOT NULL;
