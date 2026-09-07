ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_turn_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS source_repositories (
  id UUID PRIMARY KEY, full_name TEXT NOT NULL UNIQUE, url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
  default_branch TEXT NOT NULL, indexed_commit TEXT NOT NULL, validation_report JSONB NOT NULL,
  linked_by UUID REFERENCES accounts(id), linked_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE IF NOT EXISTS source_chunks (
  repository_id UUID NOT NULL REFERENCES source_repositories(id) ON DELETE CASCADE, chunk_id TEXT NOT NULL,
  source_id TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL, locator TEXT NOT NULL, authority TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL, digest TEXT NOT NULL, content TEXT NOT NULL,
  PRIMARY KEY (repository_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY, trainer_account_id UUID NOT NULL REFERENCES accounts(id), conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  target_repository TEXT NOT NULL, original_question TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ACTIVE', current_answer JSONB,
  current_report JSONB, proposal_id UUID, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS training_turns (
  id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL,
  actor TEXT NOT NULL, kind TEXT NOT NULL, content JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, UNIQUE(session_id, ordinal)
);

INSERT INTO source_repositories (id, full_name, url, status, default_branch, indexed_commit, validation_report, linked_by, linked_at, updated_at, version)
VALUES ('00000000-0000-4000-8000-000000000010', 'PointCommunity/pointaudio', 'https://github.com/PointCommunity/pointaudio', 'ACTIVE', 'main', 'configured-at-runtime', '{"valid":true,"checkedAt":"2026-09-06T00:00:00.000Z","commitSha":"configured-at-runtime","defaultBranch":"main","errors":[],"warnings":[],"filesReviewed":41,"filesIndexed":20,"chunksIndexed":20,"requirements":{"agentsFile":true,"evidenceContent":true,"integrityManifest":true}}'::jsonb, NULL, now(), now(), 1)
ON CONFLICT (full_name) DO NOTHING;
