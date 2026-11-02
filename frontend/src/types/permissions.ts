/**
 * Permission actions — 10 types per SRS V2 §3 / Handover §5
 * "verify" is new vs Gym reference — used for payment/visitor/pass verification
 */
export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'export',
  'print',
  'assign',
  'verify',           // new — payment proof, visitor, gate-pass verification
  'manage_settings',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Modules map to backend NestJS module paths */
export type PermissionModule =
  | 'tenants'
  | 'branches'
  | 'residents'
  | 'admissions'
  | 'allocations'
  | 'invoices'
  | 'payments'
  | 'payment_proofs'
  | 'visitors'
  | 'gate_passes'
  | 'gate_events'
  | 'mess'
  | 'complaints'
  | 'maintenance'
  | 'inventory'
  | 'notifications'
  | 'reports'
  | 'exports'
  | 'audit_logs'
  | 'users'
  | 'roles'
  | 'public_content';

export interface Permission {
  module: PermissionModule;
  action: PermissionAction;
}

/** Portal routes — one per role (FRONTEND_ARCH §4 / SRS V2 §3) */
export type PortalRoute =
  | '/system-admin'
  | '/owner'
  | '/warden'
  | '/reception'
  | '/accountant'
  | '/security'
  | '/mess'
  | '/maintenance'
  | '/resident'
  | '/staff';
