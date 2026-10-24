-- Who a handoff is for, the pull request it belongs to, and when it was last edited.
ALTER TABLE sessions
  ADD COLUMN assignee_id text,
  ADD COLUMN pr_url      text,
  ADD COLUMN updated_at  timestamptz;

CREATE INDEX sessions_org_assignee ON sessions (org_id, assignee_id, created_at DESC)
  WHERE deleted_at IS NULL AND assignee_id IS NOT NULL;
