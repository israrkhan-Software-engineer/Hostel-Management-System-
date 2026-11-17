BEGIN;

REVOKE INSERT, DELETE ON TABLE public.platform_admins FROM hms_app;
REVOKE DELETE ON TABLE public.platform_admin_recovery_codes FROM hms_app;
REVOKE UPDATE, DELETE ON TABLE public.platform_admin_audit_logs FROM hms_app;
REVOKE DELETE ON TABLE public.invoices, public.invoice_lines, public.payments, public.refunds FROM hms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM hms_app;

INSERT INTO public.permissions (module, action)
VALUES
  ('resident_portal', 'view'),
  ('resident_portal', 'create'),
  ('resident_portal', 'edit')
ON CONFLICT (module, action) DO NOTHING;

DELETE FROM public.role_permissions AS rp
USING public.roles AS r, public.permissions AS p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.tenant_id IS NOT NULL
  AND r.name = 'Resident'
  AND r.is_system_role = TRUE
  AND r.deleted_at IS NULL
  AND (
    (p.module = 'residents' AND p.action = 'view')
    OR (p.module = 'invoices' AND p.action = 'view')
    OR (p.module = 'payments' AND p.action IN ('view', 'create'))
    OR (p.module = 'payment_proofs' AND p.action IN ('view', 'create'))
    OR (p.module = 'offline_sync' AND p.action = 'view')
  );

DELETE FROM public.role_permissions AS rp
USING public.roles AS r, public.permissions AS p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.tenant_id IS NOT NULL
  AND r.is_system_role = TRUE
  AND r.deleted_at IS NULL
  AND r.name NOT IN ('Owner', 'System Admin', 'Warden')
  AND p.module = 'offline_sync'
  AND p.action = 'view';

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles AS r
CROSS JOIN public.permissions AS p
WHERE r.tenant_id IS NOT NULL
  AND r.name = 'Resident'
  AND r.is_system_role = TRUE
  AND r.deleted_at IS NULL
  AND p.module = 'resident_portal'
  AND p.action IN ('view', 'create', 'edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
