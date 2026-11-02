-- HMS Phase 1 Auth Migration
-- Refresh tokens (rotating, hashed), password reset tokens (single-use, time-limited)
-- SRS V2 NFR-003, NFR-004, FR-114, FR-115 / SECURITY §3

CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  token_hash   TEXT NOT NULL UNIQUE,    -- bcrypt/SHA-256 hash; never plain
  is_revoked   BOOLEAN NOT NULL DEFAULT FALSE,
  device_info  TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id, is_revoked);
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prt_user ON password_reset_tokens (user_id);
-- Password reset tokens are NOT tenant-scoped (user must be found by email/phone first)
