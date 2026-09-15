ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS accepted_content TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS accepted_digest TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS accepted_path TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS accepted_source_version INTEGER;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS published_commit TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS indexed_commit TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS publication_error TEXT;
ALTER TABLE answers ADD COLUMN IF NOT EXISTS accepted_guidance JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS training_sessions_publication_idx ON training_sessions(state, updated_at)
  WHERE state IN ('PUBLISHING', 'ACTIVATING', 'FAILED');
