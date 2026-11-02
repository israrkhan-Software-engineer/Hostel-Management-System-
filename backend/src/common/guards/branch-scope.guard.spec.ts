import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BranchScopeGuard } from './branch-scope.guard';

describe('BranchScopeGuard', () => {
  let guard: BranchScopeGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let users: {
    getBranchScopes: jest.Mock;
    canAccessAllBranches: jest.Mock;
  };
  let prisma: { runWithTenantContext: jest.Mock };

  const context = (request: object) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext);

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    users = {
      getBranchScopes: jest.fn().mockResolvedValue([]),
      canAccessAllBranches: jest.fn().mockResolvedValue(false),
    };
    prisma = { runWithTenantContext: jest.fn((_tenantId, operation) => operation()) };
    guard = new BranchScopeGuard(reflector as unknown as Reflector, users as any, prisma as any);
  });

  it('skips checks on routes without branch scoping', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
    expect(users.getBranchScopes).not.toHaveBeenCalled();
  });

  it('allows a staff member assigned to the requested branch', async () => {
    users.getBranchScopes.mockResolvedValue(['branch-1']);

    await expect(guard.canActivate(context({
      user: { userId: 'user-1', tenantId: 'tenant-1' },
      params: { branchId: 'branch-1' },
    }))).resolves.toBe(true);
    expect(prisma.runWithTenantContext).toHaveBeenCalledWith('tenant-1', expect.any(Function));
  });

  it('allows an owner or system administrator with no explicit branch scopes', async () => {
    users.canAccessAllBranches.mockResolvedValue(true);

    await expect(guard.canActivate(context({
      user: { userId: 'user-1', tenantId: 'tenant-1' },
      params: { branchId: 'branch-2' },
    }))).resolves.toBe(true);
    expect(users.canAccessAllBranches).toHaveBeenCalledWith('user-1', 'tenant-1');
  });

  it('denies users with no branch assignment unless they hold a global branch role', async () => {
    await expect(guard.canActivate(context({
      user: { userId: 'user-1', tenantId: 'tenant-1' },
      params: { branchId: 'branch-1' },
    }))).rejects.toThrow(ForbiddenException);
  });

  it('denies a staff member assigned to a different branch', async () => {
    users.getBranchScopes.mockResolvedValue(['branch-2']);

    await expect(guard.canActivate(context({
      user: { userId: 'user-1', tenantId: 'tenant-1' },
      params: { branchId: 'branch-1' },
    }))).rejects.toThrow(ForbiddenException);
  });
});
