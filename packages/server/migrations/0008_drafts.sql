-- Drafts: shares saved automatically at the end of a session (opt-in). Only the author sees
-- them until they publish; they don't count in stats or activity.
ALTER TABLE sessions ADD COLUMN draft boolean NOT NULL DEFAULT false;
CREATE INDEX sessions_org_author_native ON sessions (org_id, author_id, native_id) WHERE deleted_at IS NULL;
