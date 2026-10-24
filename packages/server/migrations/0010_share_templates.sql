-- Handoff templates: extra sections (and instructions) a share should have, per repo pattern.
ALTER TABLE org_settings ADD COLUMN share_templates jsonb NOT NULL DEFAULT '[]';
