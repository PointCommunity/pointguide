DO $$
BEGIN
  CREATE TYPE provider_kind AS ENUM ('CODEX', 'OLLAMA_CLOUD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE provider_connection_status AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE agent_profile_role AS ENUM ('PRIMARY', 'REVIEWER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS provider_connections (
  id UUID PRIMARY KEY,
  provider provider_kind NOT NULL UNIQUE,
  status provider_connection_status NOT NULL DEFAULT 'DISCONNECTED',
  encrypted_secret TEXT,
  external_secret_ref TEXT,
  credential_location TEXT,
  account_label TEXT,
  catalog_refreshed_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by UUID NOT NULL REFERENCES accounts(id),
  updated_by UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT provider_connections_secret_exclusive CHECK (encrypted_secret IS NULL OR external_secret_ref IS NULL),
  CONSTRAINT provider_connections_version_positive CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS provider_models (
  connection_id UUID NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  input_modalities JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning_efforts JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  catalog_digest TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT provider_models_pk PRIMARY KEY (connection_id, model_id)
);

CREATE INDEX IF NOT EXISTS provider_models_availability_idx ON provider_models (connection_id, available);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  role agent_profile_role NOT NULL,
  connection_id UUID NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_effort TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active_prompt_revision_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT agent_profiles_available_model_fk FOREIGN KEY (connection_id, model_id)
    REFERENCES provider_models(connection_id, model_id),
  CONSTRAINT agent_profiles_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_one_enabled_role_idx ON agent_profiles (role) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS prompt_revisions (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  owner_prompt TEXT NOT NULL,
  core_policy_revision TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL,
  supersedes_id UUID REFERENCES prompt_revisions(id),
  CONSTRAINT prompt_revisions_owner_prompt_bounded CHECK (char_length(owner_prompt) <= 12000)
);

CREATE INDEX IF NOT EXISTS prompt_revisions_profile_idx ON prompt_revisions (profile_id, created_at);

DO $$
BEGIN
  ALTER TABLE agent_profiles
    ADD CONSTRAINT agent_profiles_active_prompt_fk
    FOREIGN KEY (active_prompt_revision_id) REFERENCES prompt_revisions(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS application_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID NOT NULL REFERENCES accounts(id),
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT application_settings_version_positive CHECK (version > 0)
);
