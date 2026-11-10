ALTER TABLE users
  ADD COLUMN mfa_enrollment_secret_encrypted TEXT,
  ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN locked_until TIMESTAMPTZ,
  ADD CONSTRAINT users_failed_login_attempts_nonnegative CHECK (failed_login_attempts >= 0);

CREATE TABLE user_mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  code_hash TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_mfa_recovery_codes_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX idx_user_mfa_recovery_codes_user_used
  ON user_mfa_recovery_codes (user_id, used_at);

ALTER TABLE user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_mfa_recovery_codes
  ON user_mfa_recovery_codes FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);

INSERT INTO permissions (id, module, action)
SELECT gen_random_uuid(), module_name, action_name::"PermissionAction"
FROM (VALUES ('offline_sync'), ('backups')) AS modules(module_name)
CROSS JOIN unnest(enum_range(NULL::"PermissionAction")) AS actions(action_name)
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON (
  (permissions.module = 'branches' AND permissions.action = 'view')
  OR (permissions.module = 'users' AND permissions.action = 'view')
  OR (permissions.module = 'offline_sync' AND permissions.action = 'view')
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'backups'
  AND permissions.action IN ('view', 'manage_settings')
WHERE roles.name IN ('Owner', 'System Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
