-- Uncommitted changes attached to a share (opt-in): the patch lives in blob storage next to the transcript.
ALTER TABLE sessions
  ADD COLUMN diff_key   text,
  ADD COLUMN diff_stats jsonb;
