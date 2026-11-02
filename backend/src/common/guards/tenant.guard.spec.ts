import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: {
    tenant: { findUnique: jest.Mock };
    runWithTenantContext: jest.Mock;
  };

  const context = (request: object) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext);

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        status: 'ACTIVE',
        deletedAt: null,
      }) },
      runWithTenantContext: jest.fn((_tenantId, operation) => operation()),
    };
    guard = new TenantGuard(
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    );
  });

  it('allows public routes without tenant lookup or RLS setup', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('checks the authenticated tenant and sets the RLS context on protected routes', async () => {
    const request: { user: { userId: string; tenantId: string }; tenant?: object } = {
      user: { userId: 'user-1', tenantId: '550e8400-e29b-41d4-a716-446655440000' },
    };

    prisma.tenant.findUnique.mockResolvedValue({
      id: request.user.tenantId,
      status: 'ACTIVE',
      deletedAt: null,
    });
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.tenant).toEqual({ id: request.user.tenantId, status: 'ACTIVE', deletedAt: null });
    expect(prisma.runWithTenantContext).toHaveBeenCalledWith(request.user.tenantId, expect.any(Function));
  });

  it('denies protected requests with missing or malformed tenant IDs', async () => {
    await expect(guard.canActivate(context({ user: { userId: 'user-1', tenantId: '' } })))
      .rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context({ user: { userId: 'user-1', tenantId: 'not-a-uuid' } })))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it.each(['PROVISIONING', 'SUSPENDED', 'OFFBOARDING', 'CLOSED'])(
    'denies protected requests for %s tenants',
    async (status) => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status,
      deletedAt: null,
    });

    await expect(guard.canActivate(context({
      user: { userId: 'user-1', tenantId: '550e8400-e29b-41d4-a716-446655440000' },
    }))).rejects.toThrow(ForbiddenException);
    },
  );
});
