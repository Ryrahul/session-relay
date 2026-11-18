-- Every pull request and issue a share worked on (pr_url stays as the main PR).
ALTER TABLE sessions ADD COLUMN links jsonb NOT NULL DEFAULT '[]';

UPDATE sessions SET links = jsonb_build_array(jsonb_build_object('url', pr_url, 'kind', 'pr'))
WHERE pr_url IS NOT NULL;

-- "Which sessions worked on this PR or issue?"
CREATE INDEX sessions_links ON sessions USING gin (links jsonb_path_ops) WHERE deleted_at IS NULL;
