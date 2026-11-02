INSERT INTO permissions (module, action)
SELECT modules.module, actions.action
FROM unnest(ARRAY[
  'tenants', 'branches', 'residents', 'admissions', 'allocations',
  'invoices', 'payments', 'payment_proofs', 'visitors', 'gate_passes',
  'gate_events', 'mess', 'complaints', 'maintenance', 'inventory',
  'notifications', 'notices', 'reports', 'exports', 'audit_logs', 'users',
  'roles', 'public_content'
]::TEXT[]) AS modules(module)
CROSS JOIN unnest(enum_range(NULL::"PermissionAction")) AS actions(action)
ON CONFLICT (module, action) DO NOTHING;
