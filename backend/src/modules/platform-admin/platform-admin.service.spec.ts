import { BadRequestException, ConflictException } from '@nestjs/common';
import { verifyPassword } from '../../common/utils/password.util';
import { PlatformAdminService } from './platform-admin.service';

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;
  let prisma: {
    runWithPlatformContext: jest.Mock;
    runWithTenantContext: jest.Mock;
    tenant: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: {
      create: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    role: { findMany: jest.Mock; create: jest.Mock };
    permission: { findMany: jest.Mock };
    rolePermission: { createMany: jest.Mock };
    userRole: { deleteMany: jest.Mock; createMany: jest.Mock; create: jest.Mock };
    refreshToken: { updateMany: jest.Mock };
    passwordResetToken: { updateMany: jest.Mock };
    platformAdminAuditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      runWithPlatformContext: jest.fn((_adminId, operation) => operation()),
      runWithTenantContext: jest.fn((_tenantId, operation) => operation()),
      tenant: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        create: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      role: { findMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'owner-role' }) },
      permission: { findMany: jest.fn().mockResolvedValue([{ id: 'permission-1' }]) },
      rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userRole: { deleteMany: jest.fn(), createMany: jest.fn(), create: jest.fn() },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      platformAdminAuditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn((queries) => Promise.all(queries)),
    };
    service = new PlatformAdminService(prisma as never);
  });

  it('aggregates platform and tenant-scoped user metrics', async () => {
    let activeTenantId = '';
    prisma.tenant.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]);
    prisma.runWithTenantContext.mockImplementation(async (tenantId, operation) => {
      activeTenantId = tenantId;
      return operation();
    });
    prisma.user.count.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'ACTIVE'
        ? (activeTenantId === 'tenant-1' ? 2 : 1)
        : (activeTenantId === 'tenant-1' ? 4 : 3)),
    );

    await expect(service.dashboard('admin-1')).resolves.toEqual({
      tenantCount: 3,
      activeTenantCount: 2,
      suspendedTenantCount: 1,
      totalUsers: 7,
      activeUsers: 3,
    });
    expect(prisma.runWithPlatformContext).toHaveBeenCalledWith('admin-1', expect.any(Function));
    expect(prisma.runWithTenantContext).toHaveBeenNthCalledWith(1, 'tenant-1', expect.any(Function));
    expect(prisma.runWithTenantContext).toHaveBeenNthCalledWith(2, 'tenant-2', expect.any(Function));
    expect(prisma.user.count).toHaveBeenCalledTimes(4);
  });

  it('creates new organizations in provisioning and audits the action', async () => {
    const tenant = {
      id: 'tenant-1',
      name: 'North Hall',
      slug: 'north-hall',
      status: 'PROVISIONING',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    };
    prisma.tenant.create.mockResolvedValue(tenant);
    prisma.user.create.mockResolvedValue({ id: 'owner-1' });

    await expect(service.createTenant('admin-1', {
      name: ' North Hall ',
      slug: 'NORTH-HALL',
      ownerFirstName: ' Amina ',
      ownerLastName: ' Khan ',
      ownerEmail: ' OWNER@EXAMPLE.TEST ',
      locationAddress: ' 12 North Road ',
      ownerPassword: 'StrongOwnerPass123!',
      ownerPasswordConfirmation: 'StrongOwnerPass123!',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    })).resolves.toEqual(tenant);

    expect(prisma.tenant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'North Hall',
        slug: 'north-hall',
        locationAddress: '12 North Road',
        status: 'PROVISIONING',
      }),
    }));
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        firstName: 'Amina',
        lastName: 'Khan',
        email: 'owner@example.test',
        passwordHash: expect.stringMatching(/^pbkdf2:/),
      }),
    }));
    const ownerPasswordHash = prisma.user.create.mock.calls[0][0].data.passwordHash as string;
    await expect(verifyPassword('StrongOwnerPass123!', ownerPasswordHash)).resolves.toBe(true);
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'owner-role', permissionId: 'permission-1' }],
    });
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'owner-1', tenantId: 'tenant-1', roleId: 'owner-role' },
    });
    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platformAdminId: 'admin-1',
        action: 'tenant.create',
        targetTenantId: 'tenant-1',
        targetUserId: 'owner-1',
        metadata: { status: 'PROVISIONING' },
      }),
    }));
  });

  it('does not create a tenant when owner password confirmation differs', async () => {
    await expect(service.createTenant('admin-1', {
      name: 'North Hall',
      slug: 'north-hall',
      ownerFirstName: 'Amina',
      ownerLastName: 'Khan',
      ownerEmail: 'owner@example.test',
      locationAddress: '12 North Road',
      ownerPassword: 'StrongOwnerPass123!',
      ownerPasswordConfirmation: 'DifferentPassword123!',
    })).rejects.toThrow('Owner password and confirmation do not match');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate tenant slugs reported by PostgreSQL', async () => {
    prisma.tenant.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.createTenant('admin-1', {
      name: 'North Hall',
      slug: 'north-hall',
      ownerFirstName: 'Amina',
      ownerLastName: 'Khan',
      ownerEmail: 'owner@example.test',
      locationAddress: '12 North Road',
      ownerPassword: 'StrongOwnerPass123!',
      ownerPasswordConfirmation: 'StrongOwnerPass123!',
    })).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('updates owner details and slug without changing the tenant ID', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
    prisma.tenant.update.mockResolvedValue({
      id: 'tenant-1',
      name: 'North Hall',
      slug: 'north-campus',
      locationAddress: '12 North Road',
    });
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: 'owner-1',
        firstName: 'Amina',
        lastName: 'Khan',
        email: 'old@example.test',
      })
      .mockResolvedValueOnce(null);

    await expect(service.updateTenant('admin-1', 'tenant-1', {
      slug: 'north-campus',
      ownerFirstName: ' Amira ',
      ownerLastName: ' Khan ',
      ownerEmail: 'NEW@EXAMPLE.TEST',
      locationAddress: ' 12 North Road ',
    })).resolves.toMatchObject({ id: 'tenant-1', slug: 'north-campus' });

    expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tenant-1' },
      data: { slug: 'north-campus', locationAddress: '12 North Road' },
    }));
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'owner-1' },
      data: {
        firstName: 'Amira',
        lastName: 'Khan',
        email: 'new@example.test',
        tokenVersion: { increment: 1 },
      },
    }));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'tenant.update', targetTenantId: 'tenant-1' }),
    }));
  });

  it('resets the owner password with a hash and revokes existing sessions', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
    prisma.user.findFirst.mockResolvedValue({
      id: 'owner-1',
      firstName: 'Amina',
      lastName: 'Khan',
      email: 'owner@example.test',
    });

    await expect(service.resetTenantOwnerPassword('admin-1', 'tenant-1', {
      newPassword: 'NewStrongOwner123!',
      confirmation: 'NewStrongOwner123!',
    })).resolves.toEqual({ success: true });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { passwordHash: expect.stringMatching(/^pbkdf2:/), tokenVersion: { increment: 1 } },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'tenant_owner.password_reset',
        targetTenantId: 'tenant-1',
        targetUserId: 'owner-1',
      }),
    }));
  });

  it('rejects a duplicate owner email within the tenant without changing the owner', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: 'owner-1',
        firstName: 'Amina',
        lastName: 'Khan',
        email: 'owner@example.test',
      })
      .mockResolvedValueOnce({ id: 'other-user' });

    await expect(service.updateTenant('admin-1', 'tenant-1', {
      ownerEmail: 'other@example.test',
    })).rejects.toThrow(ConflictException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('scopes platform tenant user counts serially on the shared transaction context', async () => {
    let activeTenantScopes = 0;
    prisma.runWithTenantContext.mockImplementation(async (_tenantId, operation) => {
      if (activeTenantScopes !== 0) throw new Error('Concurrent tenant scopes share a transaction');
      activeTenantScopes += 1;
      try {
        return await operation();
      } finally {
        activeTenantScopes -= 1;
      }
    });
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', name: 'One', slug: 'one', status: 'ACTIVE', timezone: 'UTC', currency: 'PKR', createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
      { id: 'tenant-2', name: 'Two', slug: 'two', status: 'ACTIVE', timezone: 'UTC', currency: 'PKR', createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    ]);
    prisma.tenant.count.mockResolvedValue(2);
    prisma.user.count.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(1), 5)));

    await expect(service.listTenants('admin-1', { page: 1, pageSize: 10 }))
      .resolves.toMatchObject({ total: 2, items: [{ userCount: 1 }, { userCount: 1 }] });
    expect(prisma.runWithTenantContext).toHaveBeenCalledTimes(2);
  });

  it('rejects empty tenant and user updates without writing records', async () => {
    await expect(service.updateTenant('admin-1', 'tenant-1', {}))
      .rejects.toThrow(BadRequestException);
    await expect(service.updateTenantUser('admin-1', 'tenant-1', 'user-1', {}))
      .rejects.toThrow(BadRequestException);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('audits a tenant suspension with the previous and new status', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
    prisma.tenant.update.mockResolvedValue({
      id: 'tenant-1',
      status: 'SUSPENDED',
      name: 'North Hall',
    });

    await expect(service.updateTenantStatus('admin-1', 'tenant-1', { status: 'SUSPENDED' }))
      .resolves.toMatchObject({ status: 'SUSPENDED' });

    expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tenant-1' },
      data: { status: 'SUSPENDED' },
    }));
    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'tenant.suspended',
        targetTenantId: 'tenant-1',
        metadata: { previousStatus: 'ACTIVE', status: 'SUSPENDED' },
      }),
    }));
  });

  it('updates tenant details and audits the changed field names', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
    prisma.tenant.update.mockResolvedValue({
      id: 'tenant-1',
      name: 'South Hall',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    });

    await expect(service.updateTenant('admin-1', 'tenant-1', {
      name: ' South Hall ',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    })).resolves.toMatchObject({ name: 'South Hall' });

    expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tenant-1' },
      data: { name: 'South Hall', timezone: 'Asia/Karachi', currency: 'PKR' },
    }));
    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'tenant.update',
        metadata: { updatedFields: ['name', 'timezone', 'currency'] },
      }),
    }));
  });

  it('reactivates a suspended tenant and audits the transition', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'SUSPENDED' });
    prisma.tenant.update.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });

    await expect(service.updateTenantStatus('admin-1', 'tenant-1', { status: 'ACTIVE' }))
      .resolves.toMatchObject({ status: 'ACTIVE' });

    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'tenant.active',
        metadata: { previousStatus: 'SUSPENDED', status: 'ACTIVE' },
      }),
    }));
  });

  it('does not reactivate closed or offboarding tenants', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'CLOSED' });

    await expect(service.updateTenantStatus('admin-1', 'tenant-1', { status: 'ACTIVE' }))
      .rejects.toThrow('Closed or offboarding tenants cannot be reactivated or suspended');
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('deactivates a tenant user, revokes existing tokens and audits the change', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
    prisma.user.update.mockResolvedValue(undefined);
    prisma.user.findFirstOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.test',
      phone: null,
      status: 'DEACTIVATED',
      userRoles: [],
    });

    await expect(service.updateTenantUser('admin-1', 'tenant-1', 'user-1', {
      status: 'DEACTIVATED',
    })).resolves.toMatchObject({ id: 'user-1', status: 'DEACTIVATED' });

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: { status: 'DEACTIVATED', tokenVersion: { increment: 1 } },
    }));
    expect(prisma.platformAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'tenant_user.update',
        targetTenantId: 'tenant-1',
        targetUserId: 'user-1',
        metadata: expect.objectContaining({
          previousStatus: 'ACTIVE',
          status: 'DEACTIVATED',
        }),
      }),
    }));
  });

  it('rejects role IDs unavailable to the tenant without changing user roles', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
    prisma.role.findMany.mockResolvedValue([]);

    await expect(service.updateTenantUser('admin-1', 'tenant-1', 'user-1', {
      roleIds: ['invalid-role'],
    })).rejects.toThrow('Every selected role must be available to this tenant');
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userRole.createMany).not.toHaveBeenCalled();
    expect(prisma.platformAdminAuditLog.create).not.toHaveBeenCalled();
  });
});
