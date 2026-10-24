-- Full transcripts (kept in blob storage) become searchable through a separate index.
-- Filled when a full transcript is shared, and for older shares by the hourly cleanup job.
ALTER TABLE sessions ADD COLUMN transcript_search tsvector;
CREATE INDEX sessions_transcript_search ON sessions USING gin (transcript_search);
