CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

CREATE TABLE platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  mfa_secret_encrypted TEXT NOT NULL,
  status "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_admin_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_platform_admin_recovery_codes_admin_used
  ON platform_admin_recovery_codes (platform_admin_id, used_at);

CREATE TABLE platform_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id),
  action TEXT NOT NULL,
  target_tenant_id UUID,
  target_user_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_platform_admin_audit_created
  ON platform_admin_audit_logs (created_at DESC, id DESC);
CREATE INDEX idx_platform_admin_audit_tenant_created
  ON platform_admin_audit_logs (target_tenant_id, created_at DESC);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_identity_lookup ON platform_admins FOR SELECT
  USING (
    id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID
    OR lower(email) = lower(NULLIF(current_setting('hms.platform_login_email', TRUE), ''))
  );
CREATE POLICY platform_admin_self_update ON platform_admins FOR UPDATE
  USING (id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID)
  WITH CHECK (id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID);

ALTER TABLE platform_admin_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_recovery_code_scope ON platform_admin_recovery_codes FOR ALL
  USING (platform_admin_id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID)
  WITH CHECK (platform_admin_id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID);

ALTER TABLE platform_admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin_audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_audit_scope ON platform_admin_audit_logs FOR ALL
  USING (platform_admin_id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID)
  WITH CHECK (platform_admin_id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID);

GRANT SELECT, UPDATE ON platform_admins TO hms_app;
GRANT SELECT, UPDATE ON platform_admin_recovery_codes TO hms_app;
GRANT SELECT, INSERT ON platform_admin_audit_logs TO hms_app;
