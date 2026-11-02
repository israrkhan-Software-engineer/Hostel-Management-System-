GRANT SELECT, INSERT, UPDATE ON tenants TO hms_app;

CREATE POLICY platform_admin_tenant_read ON tenants FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform_admins
      WHERE platform_admins.id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID
        AND platform_admins.status = 'ACTIVE'
    )
  );

CREATE POLICY platform_admin_tenant_insert ON tenants FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM platform_admins
      WHERE platform_admins.id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID
        AND platform_admins.status = 'ACTIVE'
    )
  );

CREATE POLICY platform_admin_tenant_update ON tenants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM platform_admins
      WHERE platform_admins.id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID
        AND platform_admins.status = 'ACTIVE'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM platform_admins
      WHERE platform_admins.id = NULLIF(current_setting('hms.platform_admin_id', TRUE), '')::UUID
        AND platform_admins.status = 'ACTIVE'
    )
  );
