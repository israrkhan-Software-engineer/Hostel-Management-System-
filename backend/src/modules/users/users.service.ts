import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword } from '../../common/utils/password.util';
import { User, UserStatus, PermissionAction } from '@prisma/client';

export interface UserWithRoles extends User {
  userRoles: {
    role: {
      id: string;
      name: string;
      permissions: { permission: { module: string; action: PermissionAction } }[];
    };
  }[];
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Find a user by email within a tenant — used by auth */
  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
  }

  /** Find a user by phone within a tenant */
  async findByPhone(tenantId: string, phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
  }

  /** Find user by ID with their roles and permissions — used by guards */
  async findByIdWithRoles(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    }) as Promise<UserWithRoles | null>;
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Create a user — password is hashed here (SRS V2 NFR-003) */
  async create(data: {
    tenantId: string;
    email?: string;
    phone?: string;
    password: string;
  }): Promise<User> {
    if (!data.email && !data.phone) {
      throw new ConflictException('Either email or phone is required');
    }
    const passwordHash = await hashPassword(data.password);
    return this.prisma.user.create({
      data: {
        tenantId: data.tenantId,
        email: data.email ?? null,
        phone: data.phone ?? null,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });
  }

  /**
   * Deactivate a user — access is lost promptly via tokenVersion increment.
   * History remains auditable (SRS V2 FR-116, SECURITY §3).
   */
  async deactivate(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DEACTIVATED,
        tokenVersion: { increment: 1 }, // invalidates all existing tokens immediately
      },
    });
  }

  /** Increment tokenVersion — called on password change or explicit logout-all */
  async incrementTokenVersion(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  /** Get user's branch scopes */
  async getBranchScopes(userId: string, tenantId: string): Promise<string[]> {
    const scopes = await this.prisma.userBranchScope.findMany({
      where: { userId, branch: { tenantId } },
      select: { branchId: true },
    });
    return scopes.map((s) => s.branchId);
  }

  async canAccessAllBranches(userId: string, tenantId: string): Promise<boolean> {
    const assignments = await this.prisma.userRole.findMany({
      where: {
        userId,
        tenantId,
        role: { deletedAt: null },
      },
      select: { role: { select: { name: true } } },
    });
    return assignments.some(({ role }) => ['Owner', 'System Admin'].includes(role.name));
  }

  /** Get user's gate scopes */
  async getGateScopes(userId: string): Promise<{ branchId: string; gateRef: string }[]> {
    return this.prisma.userGateScope.findMany({
      where: { userId },
      select: { branchId: true, gateRef: true },
    });
  }
}
