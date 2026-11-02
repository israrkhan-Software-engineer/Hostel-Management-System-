-- Preserve existing password-reset records while making them tenant-scoped.
ALTER TABLE password_reset_tokens ADD COLUMN tenant_id UUID;
UPDATE password_reset_tokens AS reset_tokens
SET tenant_id = users.tenant_id
FROM users
WHERE users.id = reset_tokens.user_id;
ALTER TABLE password_reset_tokens ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Table owners are subject to RLS too; superusers and BYPASSRLS roles remain forbidden at runtime.
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE buildings FORCE ROW LEVEL SECURITY;
ALTER TABLE floors FORCE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE beds FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE user_tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE user_branch_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE user_gate_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE user_mess_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE residents FORCE ROW LEVEL SECURITY;
ALTER TABLE admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE bed_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE mess_menus FORCE ROW LEVEL SECURITY;
ALTER TABLE mess_menu_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE complaints FORCE ROW LEVEL SECURITY;
ALTER TABLE notices FORCE ROW LEVEL SECURITY;
ALTER TABLE visitor_visits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_registry_read ON tenants FOR SELECT
  USING (
    id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR slug = current_setting('hms.tenant_slug', TRUE)
  );

DROP POLICY tenant_isolation_branches ON branches;
CREATE POLICY tenant_isolation_branches ON branches FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_buildings ON buildings;
CREATE POLICY tenant_isolation_buildings ON buildings FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_floors ON floors;
CREATE POLICY tenant_isolation_floors ON floors FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_rooms ON rooms;
CREATE POLICY tenant_isolation_rooms ON rooms FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_beds ON beds;
CREATE POLICY tenant_isolation_beds ON beds FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);

CREATE POLICY tenant_isolation_user_tenant_memberships ON user_tenant_memberships FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY user_branch_scope_policy ON user_branch_scopes;
CREATE POLICY user_branch_scope_policy ON user_branch_scopes FOR ALL
  USING (branch_id IN (SELECT id FROM branches WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID))
  WITH CHECK (branch_id IN (SELECT id FROM branches WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID));
CREATE POLICY user_gate_scope_policy ON user_gate_scopes FOR ALL
  USING (branch_id IN (SELECT id FROM branches WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID))
  WITH CHECK (branch_id IN (SELECT id FROM branches WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID));
CREATE POLICY user_mess_scope_policy ON user_mess_scopes FOR ALL
  USING (branch_id IN (SELECT id FROM branches WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID))
  WITH CHECK (branch_id IN (SELECT id FROM branches WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID));

CREATE POLICY tenant_isolation_roles ON roles FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
CREATE POLICY tenant_read_system_roles ON roles FOR SELECT
  USING (NULLIF(current_setting('hms.current_tenant_id', TRUE), '') IS NOT NULL
    AND (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID));
CREATE POLICY tenant_read_role_permissions ON role_permissions FOR SELECT
  USING (role_id IN (SELECT id FROM roles));
CREATE POLICY tenant_manage_role_permissions ON role_permissions FOR ALL
  USING (role_id IN (
    SELECT id FROM roles
    WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
  ))
  WITH CHECK (role_id IN (
    SELECT id FROM roles
    WHERE tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
  ));
DROP POLICY tenant_isolation_user_roles ON user_roles;
CREATE POLICY tenant_isolation_user_roles ON user_roles FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_audit ON audit_logs;
CREATE POLICY tenant_isolation_audit ON audit_logs FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);

DROP POLICY tenant_isolation_refresh_tokens ON refresh_tokens;
CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
CREATE POLICY refresh_token_bootstrap_read ON refresh_tokens FOR SELECT
  USING (token_hash = current_setting('hms.auth_token_hash', TRUE));
CREATE POLICY tenant_isolation_password_reset_tokens ON password_reset_tokens FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
CREATE POLICY password_reset_token_bootstrap_read ON password_reset_tokens FOR SELECT
  USING (token_hash = current_setting('hms.auth_token_hash', TRUE));

DROP POLICY tenant_isolation_residents ON residents;
CREATE POLICY tenant_isolation_residents ON residents FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_admissions ON admissions;
CREATE POLICY tenant_isolation_admissions ON admissions FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_bed_allocations ON bed_allocations;
CREATE POLICY tenant_isolation_bed_allocations ON bed_allocations FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_invoices ON invoices;
CREATE POLICY tenant_isolation_invoices ON invoices FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_invoice_lines ON invoice_lines;
CREATE POLICY tenant_isolation_invoice_lines ON invoice_lines FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_payments ON payments;
CREATE POLICY tenant_isolation_payments ON payments FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_refunds ON refunds;
CREATE POLICY tenant_isolation_refunds ON refunds FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_mess_menus ON mess_menus;
CREATE POLICY tenant_isolation_mess_menus ON mess_menus FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_mess_menu_entries ON mess_menu_entries;
CREATE POLICY tenant_isolation_mess_menu_entries ON mess_menu_entries FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_complaints ON complaints;
CREATE POLICY tenant_isolation_complaints ON complaints FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_notices ON notices;
CREATE POLICY tenant_isolation_notices ON notices FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);
DROP POLICY tenant_isolation_visitor_visits ON visitor_visits;
CREATE POLICY tenant_isolation_visitor_visits ON visitor_visits FOR ALL
  USING (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hms_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO hms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO hms_app;
REVOKE INSERT, UPDATE, DELETE ON tenants, permissions FROM hms_app;
REVOKE UPDATE, DELETE ON audit_logs FROM hms_app;
REVOKE ALL ON TABLE "_prisma_migrations" FROM hms_app;