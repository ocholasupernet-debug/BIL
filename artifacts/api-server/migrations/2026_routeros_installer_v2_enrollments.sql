CREATE TABLE IF NOT EXISTS routeros_installer_v2_enrollments (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  admin_id BIGINT NOT NULL,
  router_id BIGINT NOT NULL,
  release TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'consumed', 'expired', 'revoked')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ,
  source_ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS routeros_installer_v2_enrollments_owner_idx
  ON routeros_installer_v2_enrollments (admin_id, router_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS routeros_installer_v2_enrollments_expiry_idx
  ON routeros_installer_v2_enrollments (expires_at)
  WHERE status = 'issued';

ALTER TABLE routeros_installer_v2_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON routeros_installer_v2_enrollments FROM anon, authenticated;
GRANT ALL ON routeros_installer_v2_enrollments TO service_role;
REVOKE ALL ON SEQUENCE routeros_installer_v2_enrollments_id_seq FROM anon, authenticated;
GRANT ALL ON SEQUENCE routeros_installer_v2_enrollments_id_seq TO service_role;
