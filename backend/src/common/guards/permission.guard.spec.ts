import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { SKIP_PERMISSION_CHECK_KEY } from '../decorators/skip-permission-check.decorator';

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let mockReflector: { getAllAndOverride: jest.Mock };
  let mockRoles: { userHasPermission: jest.Mock };
  let mockPrisma: { runWithTenantContext: jest.Mock; tenantSubscription: { findFirst: jest.Mock; update: jest.Mock } };
  let requiredPermission: { module: string; action: string } | undefined;

  const makeContext = (user?: { userId: string; tenantId: string }) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext);

  beforeEach(() => {
    requiredPermission = undefined;
    mockReflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY || key === SKIP_PERMISSION_CHECK_KEY) return false;
        if (key === PERMISSION_KEY) return requiredPermission;
        return undefined;
      }),
    };
    mockRoles = { userHasPermission: jest.fn() };
    mockPrisma = {
      runWithTenantContext: jest.fn((_tenantId, operation) => operation()),
      tenantSubscription: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          periodEndsAt: new Date(Date.now() + 60_000),
          plan: { features: { payments: true, gate_passes: true, exports: true, residents: true } },
        }),
        update: jest.fn(),
      },
    };
    guard = new PermissionGuard(mockReflector as unknown as Reflector, mockRoles as any, mockPrisma as any);
  });

  it('denies endpoints without a permission declaration', async () => {
    await expect(guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' })))
      .rejects.toThrow('This endpoint does not declare a required permission');
    expect(mockRoles.userHasPermission).not.toHaveBeenCalled();
  });

  it('allows explicitly public endpoints', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('allows an explicit SkipPermissionCheck opt-out', async () => {
    requiredPermission = undefined;
    mockReflector.getAllAndOverride.mockImplementation(
      (key: string) => key === SKIP_PERMISSION_CHECK_KEY,
    );
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('passes when user has the required permission', async () => {
    requiredPermission = { module: 'payments', action: 'verify' };
    mockRoles.userHasPermission.mockResolvedValue(true);
    const result = await guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }));
    expect(result).toBe(true);
    expect(mockRoles.userHasPermission).toHaveBeenCalledWith('u1', 't1', 'payments', 'verify');
    expect(mockPrisma.runWithTenantContext).toHaveBeenCalledWith('t1', expect.any(Function));
  });

  it('allows the resident portal when legacy resident access remains enabled', async () => {
    requiredPermission = { module: 'resident_portal', action: 'view' };
    mockRoles.userHasPermission.mockResolvedValue(true);
    mockPrisma.tenantSubscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      periodEndsAt: new Date(Date.now() + 60_000),
      plan: { features: { residents: true } },
    });

    await expect(guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }))).resolves.toBe(true);
  });

  it('throws ForbiddenException when permission is missing', async () => {
    requiredPermission = { module: 'exports', action: 'export' };
    mockRoles.userHasPermission.mockResolvedValue(false);
    await expect(guard.canActivate(makeContext({ userId: 'u1', tenantId: 't1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns false when no user on request', async () => {
    requiredPermission = { module: 'residents', action: 'view' };
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
      requiredPermission = { module, action };
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
