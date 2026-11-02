import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  module: string;
  action: string;
}

/**
 * Declare the permission required for a route.
 * Works with PermissionGuard (L4 in the guard chain).
 *
 * @example
 * @RequirePermission('payments', 'verify')   // only users with Verify can confirm proofs
 * @RequirePermission('residents', 'view')
 * @RequirePermission('exports', 'export')
 */
export const RequirePermission = (module: string, action: string) =>
  SetMetadata(PERMISSION_KEY, { module, action } as RequiredPermission);
