import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { Reflector } from '@nestjs/core';

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let mockReflector: { getAllAndOverride: jest.Mock };
  let mockRoles: { userHasPermission: jest.Mock };
  let mockPrisma: { runWithTenantContext: jest.Mock };

  const makeContext = (user?: { userId: string; tenantId: string }) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext);

  beforeEach(() => {
    mockReflector = { getAllAndOverride: jest.fn() };
    mockRoles = { userHasPermission: jest.fn() };
    mockPrisma = { runWithTenantContext: jest.fn((_tenantId, operation) => operation()) };
    guard = new PermissionGuard(mockReflector as unknown as Reflector, mockRoles as any, mockPrisma as any);
  });

  it('passes when no @RequirePermission decorator', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const result = await guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }));
    expect(result).toBe(true);
    expect(mockRoles.userHasPermission).not.toHaveBeenCalled();
  });

  it('passes when user has the required permission', async () => {
    mockReflector.getAllAndOverride.mockReturnValue({ module: 'payments', action: 'verify' });
    mockRoles.userHasPermission.mockResolvedValue(true);
    const result = await guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }));
    expect(result).toBe(true);
    expect(mockRoles.userHasPermission).toHaveBeenCalledWith('u1', 't1', 'payments', 'verify');
    expect(mockPrisma.runWithTenantContext).toHaveBeenCalledWith('t1', expect.any(Function));
  });

  it('throws ForbiddenException when permission is missing', async () => {
    mockReflector.getAllAndOverride.mockReturnValue({ module: 'exports', action: 'export' });
    mockRoles.userHasPermission.mockResolvedValue(false);
    await expect(guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns false when no user on request', async () => {
    mockReflector.getAllAndOverride.mockReturnValue({ module: 'residents', action: 'view' });
    const result = await guard.canActivate(makeContext(undefined));
    expect(result).toBe(false);
  });

  // Authorization matrix spot-checks per PRD §8 / SRS V2 §3
  const matrix = [
    { role: 'Accountant', module: 'payments',      action: 'verify',  allowed: true },
    { role: 'Security',   module: 'gate_passes',   action: 'verify',  allowed: true },
    { role: 'Resident',   module: 'payments',      action: 'verify',  allowed: false },
    { role: 'Mess Staff', module: 'audit_logs',    action: 'view',    allowed: false },
    { role: 'Resident',   module: 'exports',       action: 'export',  allowed: false },
  ];

  for (const { role, module, action, allowed } of matrix) {
    it(`${role} ${allowed ? 'can' : 'cannot'} ${action} ${module}`, async () => {
      mockReflector.getAllAndOverride.mockReturnValue({ module, action });
      mockRoles.userHasPermission.mockResolvedValue(allowed);
      if (allowed) {
        const result = await guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }));
        expect(result).toBe(true);
      } else {
        await expect(
          guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' })),
        ).rejects.toThrow(ForbiddenException);
      }
    });
  }
});
