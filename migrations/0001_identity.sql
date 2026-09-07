DO $$
BEGIN
  CREATE TYPE account_role AS ENUM ('USER', 'TRAINER', 'ADMIN', 'OWNER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE account_status AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  access_issuer TEXT NOT NULL,
  access_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role account_role NOT NULL DEFAULT 'USER',
  status account_status NOT NULL DEFAULT 'PENDING',
  first_login_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT accounts_access_identity_unique UNIQUE (access_issuer, access_subject),
  CONSTRAINT accounts_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS accounts_status_role_idx ON accounts (status, role);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  actor_id UUID REFERENCES accounts(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  outcome TEXT NOT NULL,
  correlation_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events (target_type, target_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor_id, occurred_at);
