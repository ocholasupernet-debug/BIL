-- Additive schema for the CORPORATE SITE ONLY.
-- Apply explicitly to development; on VPS only to its new dedicated database.
CREATE TABLE IF NOT EXISTS isplatty_org_admins (
  username text PRIMARY KEY CHECK (username = 'user'),
  password_hash text NOT NULL,
  must_change boolean NOT NULL DEFAULT true,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS isplatty_org_admin_sessions (
  token_hash char(64) PRIMARY KEY,
  username text REFERENCES isplatty_org_admins(username) ON DELETE CASCADE,
  csrf_token char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS isplatty_org_admin_sessions_user ON isplatty_org_admin_sessions(username);
CREATE TABLE IF NOT EXISTS isplatty_org_content (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  content jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS isplatty_org_admin_audit (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL
);
CREATE TABLE IF NOT EXISTS isplatty_org_media (
  id uuid PRIMARY KEY,
  name varchar(150) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE isplatty_org_inquiries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved'));
ALTER TABLE isplatty_org_inquiries ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
