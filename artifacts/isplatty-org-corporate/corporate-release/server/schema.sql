-- ISPLATTY.ORG only. Apply to the new project's development database.
-- Production schema is applied through the owner-approved Publish flow.
CREATE TABLE IF NOT EXISTS isplatty_org_inquiries (
  reference uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name varchar(100) NOT NULL,
  email varchar(254) NOT NULL,
  phone varchar(30) NOT NULL DEFAULT '',
  location varchar(150) NOT NULL DEFAULT '',
  service varchar(100) NOT NULL,
  message varchar(3000) NOT NULL,
  consent boolean NOT NULL CHECK (consent = true)
);
CREATE TABLE IF NOT EXISTS isplatty_org_form_tokens (
  token_hash char(64) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS isplatty_org_rate_limits (
  key char(64) PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  count integer NOT NULL
);
