CREATE TABLE training_sources (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('FILE','URL')),
  original_name text NOT NULL,
  media_type text NOT NULL,
  source_url text,
  final_url text,
  original_size integer CHECK (original_size IS NULL OR (original_size > 0 AND original_size <= 15728640)),
  original_digest text,
  original_bytes bytea,
  extracted_text text CHECK (extracted_text IS NULL OR char_length(extracted_text) <= 1000000),
  extracted_digest text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY','FAILED')),
  error text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX training_sources_session_idx ON training_sources(session_id, created_at);
