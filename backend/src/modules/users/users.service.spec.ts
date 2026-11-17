import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
  };
  const service = new UsersService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds only active tenant users by case-insensitive email', async () => {
    await service.findByEmail('tenant-1', ' Resident@Example.Test ');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        deletedAt: null,
        email: { equals: 'Resident@Example.Test', mode: 'insensitive' },
      },
    });
  });

  it('finds only active tenant users by normalized phone', async () => {
    await service.findByPhone('tenant-1', ' 03001234567 ');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', deletedAt: null, phone: '03001234567' },
    });
  });

  it('excludes soft-deleted users from ID lookup', async () => {
    await service.findById('user-1');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', deletedAt: null },
    });
  });

  it('excludes permissions from deleted roles when loading a user profile', async () => {
    await service.findByIdWithRoles('user-1');

    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', deletedAt: null },
      include: {
        userRoles: expect.objectContaining({
          where: { role: { deletedAt: null } },
        }),
      },
    }));
  });
});
