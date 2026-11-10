import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword } from '../../common/utils/password.util';
import { AuditService } from '../audit/audit.service';
import {
  CreateTenantUserDto,
  ResetTenantUserPasswordDto,
  SaveTenantRoleDto,
  UpdateTenantUserProfileDto,
} from './tenant-management.dto';

type Actor = { userId: string; tenantId: string };

@Injectable()
export class TenantManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listUsers(actor: Actor, page = 1, pageSize = 25) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { tenantId: actor.tenantId, deletedAt: null, residentProfile: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          userRoles: {
            where: { tenantId: actor.tenantId },
            select: { role: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where: { tenantId: actor.tenantId, deletedAt: null, residentProfile: null } }),
    ]);
    return { items, page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
  }

  async listRoles(tenantId: string) {
    const [roles, permissions] = await Promise.all([
      this.prisma.role.findMany({
        where: { deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
        select: {
          id: true,
          name: true,
          description: true,
          isSystemRole: true,
          permissions: { select: { permission: { select: { id: true, module: true, action: true } } } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.permission.findMany({
        orderBy: [{ module: 'asc' }, { action: 'asc' }],
        select: { id: true, module: true, action: true },
      }),
    ]);
    return { roles, permissions };
  }

  async subscriptionSummary(tenantId: string) {
    const [subscription, activeUsers, branches] = await Promise.all([
      this.prisma.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { plan: { select: { name: true, userLimit: true, branchLimit: true, features: true } } },
      }),
      this.prisma.user.count({
        where: { tenantId, status: UserStatus.ACTIVE, deletedAt: null },
      }),
      this.prisma.branch.count({ where: { tenantId, deletedAt: null } }),
    ]);
    return {
      subscription,
      usage: {
        activeUsers,
        userLimit: subscription?.plan.userLimit ?? 0,
        branches,
        branchLimit: subscription?.plan.branchLimit ?? 0,
      },
    };
  }

  async createUser(actor: Actor, dto: CreateTenantUserDto) {
    if (!dto.email?.trim() && !dto.phone?.trim()) {
      throw new BadRequestException('Provide an email address or phone number');
    }
    const roleIds = [...new Set(dto.roleIds)];
    if (!roleIds.length) throw new BadRequestException('Assign at least one role');
    const passwordHash = await hashPassword(dto.temporaryPassword);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const plan = await this.lockAndReadPlan(tx, actor.tenantId);
        const activeUsers = await tx.user.count({
          where: { tenantId: actor.tenantId, status: UserStatus.ACTIVE, deletedAt: null },
        });
        if (activeUsers >= plan.userLimit) {
          throw new ConflictException(
            `This plan allows ${plan.userLimit} active users. Upgrade the plan to add more staff.`,
          );
        }
        await this.assertRolesWithinActorCeiling(tx, actor, roleIds);
        const created = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            email: dto.email?.trim().toLowerCase() || null,
            phone: dto.phone?.trim() || null,
            passwordHash,
            status: UserStatus.ACTIVE,
          },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
        });
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: created.id, tenantId: actor.tenantId, roleId })),
        });
        return created;
      });
      await this.audit.log({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'tenant_user.create',
        module: 'users',
        entityType: 'user',
        entityId: user.id,
        outcome: 'success',
        metadata: { roleIds },
      });
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email or phone number already belongs to an account');
      }
      throw error;
    }
  }

  async updateUser(actor: Actor, userId: string, dto: UpdateTenantUserProfileDto) {
    if (userId === actor.userId) {
      throw new ForbiddenException('You cannot change your own account roles or status here');
    }
    if (!Object.keys(dto).length) throw new BadRequestException('Provide a user field to update');
    const roleIds = dto.roleIds ? [...new Set(dto.roleIds)] : undefined;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const current = await tx.user.findFirst({
          where: { id: userId, tenantId: actor.tenantId, deletedAt: null, residentProfile: null },
          select: {
            id: true,
            status: true,
            userRoles: {
              where: { tenantId: actor.tenantId },
              select: { role: { select: { name: true, isSystemRole: true } } },
            },
          },
        });
        if (!current) throw new NotFoundException('User not found');
        if (current.userRoles.some(({ role }) => role.name === 'Owner' && role.isSystemRole)) {
          throw new ForbiddenException('Use platform administration to manage the owner account');
        }
        if (dto.status === UserStatus.ACTIVE && current.status !== UserStatus.ACTIVE) {
          const plan = await this.lockAndReadPlan(tx, actor.tenantId);
          const activeUsers = await tx.user.count({
            where: { tenantId: actor.tenantId, status: UserStatus.ACTIVE, deletedAt: null },
          });
          if (activeUsers >= plan.userLimit) {
            throw new ConflictException(
              `This plan allows ${plan.userLimit} active users. Upgrade the plan to reactivate this account.`,
            );
          }
        }
        if (roleIds) {
          if (!roleIds.length) throw new BadRequestException('A user must retain at least one role');
          await this.assertRolesWithinActorCeiling(tx, actor, roleIds);
          await tx.userRole.deleteMany({ where: { userId, tenantId: actor.tenantId } });
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({ userId, tenantId: actor.tenantId, roleId })),
          });
        }
        const data = {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
          ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.status !== undefined && dto.status !== current.status
            ? { tokenVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null }
            : {}),
        };
        if (dto.status === UserStatus.DEACTIVATED) {
          await tx.refreshToken.updateMany({
            where: { userId, tenantId: actor.tenantId, isRevoked: false },
            data: { isRevoked: true, revokedAt: new Date() },
          });
        }
        return tx.user.update({
          where: { id: userId },
          data,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
            userRoles: { where: { tenantId: actor.tenantId }, select: { role: { select: { id: true, name: true } } } },
          },
        });
      });
      await this.audit.log({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'tenant_user.update',
        module: 'users',
        entityType: 'user',
        entityId: userId,
        outcome: 'success',
        metadata: {
          updatedFields: Object.keys(dto).filter((field) => field !== 'roleIds'),
          ...(roleIds ? { roleIds } : {}),
        },
      });
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email or phone number already belongs to an account');
      }
      throw error;
    }
  }

  async resetUserPassword(actor: Actor, userId: string, dto: ResetTenantUserPasswordDto) {
    if (userId === actor.userId) {
      throw new BadRequestException('Use change-password to update your own password');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: actor.tenantId, deletedAt: null, residentProfile: null },
      select: {
        id: true,
        userRoles: {
          where: { tenantId: actor.tenantId },
          select: { role: { select: { name: true, isSystemRole: true } } },
        },
      },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.userRoles.some(({ role }) => role.name === 'Owner' && role.isSystemRole)) {
      throw new ForbiddenException('Use platform administration to reset the owner password');
    }
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, tenantId: actor.tenantId, deletedAt: null, residentProfile: null },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    if (updated.count !== 1) throw new NotFoundException('User not found');
    await this.prisma.refreshToken.updateMany({
      where: { userId, tenantId: actor.tenantId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, tenantId: actor.tenantId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.audit.log({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'tenant_user.password_reset',
      module: 'users',
      entityType: 'user',
      entityId: userId,
      outcome: 'success',
    });
    return { success: true };
  }

  async createRole(actor: Actor, dto: SaveTenantRoleDto) {
    const permissions = await this.validateRolePermissions(actor, dto.permissionIds);
    try {
      const role = await this.prisma.role.create({
        data: {
          tenantId: actor.tenantId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          isSystemRole: false,
          permissions: { create: permissions.map((permissionId) => ({ permissionId })) },
        },
        include: { permissions: { select: { permissionId: true } } },
      });
      await this.audit.log({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'tenant_role.create',
        module: 'roles',
        entityType: 'role',
        entityId: role.id,
        outcome: 'success',
        metadata: { permissionIds: permissions },
      });
      return role;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async updateRole(actor: Actor, roleId: string, dto: SaveTenantRoleDto) {
    const permissions = await this.validateRolePermissions(actor, dto.permissionIds);
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId: actor.tenantId, deletedAt: null, isSystemRole: false },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Custom role not found');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: permissions.map((permissionId) => ({ roleId, permissionId })),
        });
        return tx.role.update({
          where: { id: roleId },
          data: { name: dto.name.trim(), description: dto.description?.trim() || null },
          include: { permissions: { select: { permissionId: true } } },
        });
      });
      await this.audit.log({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'tenant_role.update',
        module: 'roles',
        entityType: 'role',
        entityId: roleId,
        outcome: 'success',
        metadata: { permissionIds: permissions },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async deleteRole(actor: Actor, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId: actor.tenantId, deletedAt: null, isSystemRole: false },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Custom role not found');
    const assigned = await this.prisma.userRole.count({ where: { roleId, tenantId: actor.tenantId } });
    if (assigned) throw new ConflictException('Remove this role from users before deleting it');
    await this.prisma.role.update({ where: { id: roleId }, data: { deletedAt: new Date() } });
    await this.audit.log({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'tenant_role.delete',
      module: 'roles',
      entityType: 'role',
      entityId: roleId,
      outcome: 'success',
    });
    return { success: true };
  }

  private async lockAndReadPlan(tx: Prisma.TransactionClient, tenantId: string) {
    const [subscription] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tenant_subscriptions
      WHERE tenant_id = ${tenantId}::uuid
        AND status IN ('TRIAL', 'ACTIVE')
        AND period_ends_at > NOW()
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `;
    if (!subscription) {
      throw new ConflictException('An active subscription is required to add staff accounts');
    }
    const current = await tx.tenantSubscription.findUnique({
      where: { id: subscription.id },
      include: { plan: { select: { userLimit: true } } },
    });
    if (!current) throw new ConflictException('Subscription plan could not be resolved');
    return current.plan;
  }

  private async validateRolePermissions(actor: Actor, requestedIds: string[]) {
    const uniqueIds = [...new Set(requestedIds)];
    const available = await this.prisma.permission.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (available.length !== uniqueIds.length) {
      throw new BadRequestException('Every permission must exist in the permission catalog');
    }
    await this.assertPermissionsWithinActorCeiling(actor, uniqueIds);
    return uniqueIds;
  }

  private async assertRolesWithinActorCeiling(
    tx: Prisma.TransactionClient,
    actor: Actor,
    roleIds: string[],
  ) {
    const roles = await tx.role.findMany({
      where: {
        id: { in: roleIds },
        deletedAt: null,
        OR: [{ tenantId: actor.tenantId }, { tenantId: null }],
      },
      select: {
        id: true,
        permissions: { select: { permissionId: true } },
      },
    });
    if (roles.length !== roleIds.length) {
      throw new BadRequestException('Every selected role must be available to this tenant');
    }
    await this.assertPermissionsWithinActorCeiling(
      actor,
      roles.flatMap((role) => role.permissions.map(({ permissionId }) => permissionId)),
    );
  }

  private async assertPermissionsWithinActorCeiling(actor: Actor, permissionIds: string[]) {
    const [actorRoles, requestedPermissions] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { userId: actor.userId, tenantId: actor.tenantId, role: { deletedAt: null } },
        select: { role: { select: { permissions: { select: { permissionId: true } } } } },
      }),
      this.prisma.permission.findMany({
        where: { id: { in: [...new Set(permissionIds)] } },
        select: { id: true, module: true, action: true },
      }),
    ]);
    const ceiling = new Set(
      actorRoles.flatMap(({ role }) => role.permissions.map(({ permissionId }) => permissionId)),
    );
    if (requestedPermissions.length !== new Set(permissionIds).size
      || requestedPermissions.some(({ id }) => !ceiling.has(id))) {
      throw new ForbiddenException('You cannot delegate permissions you do not have');
    }
  }
}
