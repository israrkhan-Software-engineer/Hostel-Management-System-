import {
  ConflictException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { hasPrismaErrorCode } from '../../common/utils/prisma-error.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword } from '../../common/utils/password.util';
import {
  CreateTenantDto,
  PlatformPaginationDto,
  ResetTenantOwnerPasswordDto,
  TenantQueryDto,
  TenantUserQueryDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
  UpdateTenantUserDto,
} from './platform-admin.dto';

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  locationAddress: true,
  status: true,
  timezone: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(adminId: string) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const [tenantCount, activeTenantCount, suspendedTenantCount, tenants] = await Promise.all([
        this.prisma.tenant.count({ where: { deletedAt: null } }),
        this.prisma.tenant.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        this.prisma.tenant.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
        this.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } }),
      ]);
      let totalUsers = 0;
      let activeUsers = 0;
      for (const tenant of tenants) {
        const counts = await this.prisma.runWithTenantContext(tenant.id, async () => {
          const [all, active] = await Promise.all([
            this.prisma.user.count({ where: { deletedAt: null } }),
            this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
          ]);
          return { all, active };
        });
        totalUsers += counts.all;
        activeUsers += counts.active;
      }
      return { tenantCount, activeTenantCount, suspendedTenantCount, totalUsers, activeUsers };
    });
  }

  async listTenants(adminId: string, filter: TenantQueryDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const where = {
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.search?.trim()
          ? {
              OR: [
                { name: { contains: filter.search.trim(), mode: 'insensitive' as const } },
                { slug: { contains: filter.search.trim(), mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [tenants, total] = await this.prisma.$transaction([
        this.prisma.tenant.findMany({
          where,
          select: tenantSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
        this.prisma.tenant.count({ where }),
      ]);
      const rows: Array<(typeof tenants)[number] & { userCount: number }> = [];
      for (const tenant of tenants) {
        const userCount = await this.prisma.runWithTenantContext(tenant.id, () =>
          this.prisma.user.count({ where: { deletedAt: null } }),
        );
        rows.push({ ...tenant, userCount });
      }
      return this.paginated(rows, total, filter);
    });
  }

  async getTenant(adminId: string, tenantId: string) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const tenant = await this.prisma.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
        select: tenantSelect,
      });
      if (!tenant) throw new NotFoundException('Tenant not found');
      const [userCount, activeUserCount, owner] = await this.prisma.runWithTenantContext(tenantId, () =>
        Promise.all([
          this.prisma.user.count({ where: { deletedAt: null } }),
          this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
          this.findTenantOwner(tenantId),
        ]),
      );
      return { ...tenant, userCount, activeUserCount, owner };
    });
  }

  async createTenant(adminId: string, dto: CreateTenantDto) {
    this.validateTenantDetails(dto);
    if (dto.ownerPassword !== dto.ownerPasswordConfirmation) {
      throw new BadRequestException('Owner password and confirmation do not match');
    }
    this.validateTimezone(dto.timezone);
    const ownerPasswordHash = await hashPassword(dto.ownerPassword);

    return this.prisma.runWithPlatformContext(adminId, async () => {
      try {
        const tenant = await this.prisma.tenant.create({
          data: {
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            locationAddress: dto.locationAddress.trim(),
            status: TenantStatus.PROVISIONING,
            ...(dto.timezone ? { timezone: dto.timezone } : {}),
            ...(dto.currency ? { currency: dto.currency } : {}),
          },
          select: tenantSelect,
        });
        const owner = await this.prisma.runWithTenantContext(tenant.id, async () => {
          const role = await this.prisma.role.create({
            data: { tenantId: tenant.id, name: 'Owner', isSystemRole: true },
            select: { id: true },
          });
          const permissions = await this.prisma.permission.findMany({ select: { id: true } });
          if (!permissions.length) {
            throw new InternalServerErrorException('Platform permissions have not been initialized');
          }
          await this.prisma.rolePermission.createMany({
            data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
          });
          const createdOwner = await this.prisma.user.create({
            data: {
              tenantId: tenant.id,
              firstName: dto.ownerFirstName.trim(),
              lastName: dto.ownerLastName.trim(),
              email: dto.ownerEmail.trim().toLowerCase(),
              passwordHash: ownerPasswordHash,
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          await this.prisma.userRole.create({
            data: { userId: createdOwner.id, tenantId: tenant.id, roleId: role.id },
          });
          return createdOwner;
        });
        const trialSettings = await this.prisma.trialSettings.findUnique({ where: { id: 1 } });
        if (!trialSettings) {
          throw new InternalServerErrorException('Platform trial settings have not been initialized');
        }
        const trialStartedAt = new Date();
        const trialEndsAt = new Date(
          trialStartedAt.getTime() + trialSettings.durationDays * 86_400_000,
        );
        const subscription = await this.prisma.tenantSubscription.create({
          data: {
            tenantId: tenant.id,
            planId: trialSettings.trialPlanId,
            status: 'TRIAL',
            trialStartedAt,
            trialEndsAt,
            periodStartedAt: trialStartedAt,
            periodEndsAt: trialEndsAt,
          },
        });
        await this.prisma.subscriptionHistory.create({
          data: {
            tenantId: tenant.id,
            subscriptionId: subscription.id,
            platformAdminId: adminId,
            event: 'trial.started',
            details: {
              planId: trialSettings.trialPlanId,
              durationDays: trialSettings.durationDays,
            },
          },
        });
        await this.audit(adminId, 'tenant.create', tenant.id, { status: tenant.status }, owner.id);
        return tenant;
      } catch (error) {
        if (hasPrismaErrorCode(error, 'P2002')) {
          throw new ConflictException('Tenant slug or owner email already exists');
        }
        throw error;
      }
    });
  }

  async updateTenant(adminId: string, tenantId: string, dto: UpdateTenantDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      if (!Object.keys(dto).length) {
        throw new BadRequestException('Provide at least one tenant field to update');
      }
      if (dto.name !== undefined && !dto.name.trim()) {
        throw new BadRequestException('Tenant name cannot be empty');
      }
      if (dto.ownerFirstName !== undefined && !dto.ownerFirstName.trim()) {
        throw new BadRequestException('Owner first name cannot be empty');
      }
      if (dto.ownerLastName !== undefined && !dto.ownerLastName.trim()) {
        throw new BadRequestException('Owner last name cannot be empty');
      }
      if (dto.ownerEmail !== undefined && !dto.ownerEmail.trim()) {
        throw new BadRequestException('Owner email cannot be empty');
      }
      if (dto.locationAddress !== undefined && !dto.locationAddress.trim()) {
        throw new BadRequestException('Hostel location cannot be empty');
      }
      this.validateTimezone(dto.timezone);
      await this.requireTenant(tenantId);
      const tenantFields = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.slug !== undefined ? { slug: dto.slug.trim().toLowerCase() } : {}),
        ...(dto.locationAddress !== undefined ? { locationAddress: dto.locationAddress.trim() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      };
      try {
        const tenant = Object.keys(tenantFields).length
          ? await this.prisma.tenant.update({
              where: { id: tenantId },
              data: tenantFields,
              select: tenantSelect,
            })
          : await this.prisma.tenant.findFirst({
              where: { id: tenantId, deletedAt: null },
              select: tenantSelect,
            });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const ownerDetailsChanged = dto.ownerFirstName !== undefined
          || dto.ownerLastName !== undefined || dto.ownerEmail !== undefined;
        if (ownerDetailsChanged) {
          await this.prisma.runWithTenantContext(tenantId, async () => {
            const owner = await this.findTenantOwner(tenantId);
            if (!owner) throw new NotFoundException('Hostel owner not found');
            const email = dto.ownerEmail?.trim().toLowerCase();
            if (email && email !== owner.email?.toLowerCase()) {
              const duplicate = await this.prisma.user.findFirst({
                where: {
                  tenantId,
                  deletedAt: null,
                  email: { equals: email, mode: 'insensitive' },
                  id: { not: owner.id },
                },
                select: { id: true },
              });
              if (duplicate) throw new ConflictException('Owner email already exists in this tenant');
            }
            const emailChanged = Boolean(email && email !== owner.email?.toLowerCase());
            await this.prisma.user.update({
              where: { id: owner.id },
              data: {
                ...(dto.ownerFirstName !== undefined ? { firstName: dto.ownerFirstName.trim() } : {}),
                ...(dto.ownerLastName !== undefined ? { lastName: dto.ownerLastName.trim() } : {}),
                ...(email ? { email } : {}),
                ...(emailChanged ? { tokenVersion: { increment: 1 } } : {}),
              },
            });
            if (emailChanged) await this.invalidateOwnerSessions(tenantId, owner.id);
          });
        }

        await this.audit(adminId, 'tenant.update', tenant.id, {
          updatedFields: Object.keys(dto),
        });
        return tenant;
      } catch (error) {
        if (hasPrismaErrorCode(error, 'P2002')) {
          throw new ConflictException('Tenant slug or owner email already exists');
        }
        throw error;
      }
    });
  }

  async resetTenantOwnerPassword(
    adminId: string,
    tenantId: string,
    dto: ResetTenantOwnerPasswordDto,
  ) {
    if (dto.newPassword !== dto.confirmation) {
      throw new BadRequestException('Password and confirmation do not match');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    return this.prisma.runWithPlatformContext(adminId, async () => {
      await this.requireTenant(tenantId);
      return this.prisma.runWithTenantContext(tenantId, async () => {
        const owner = await this.findTenantOwner(tenantId);
        if (!owner) throw new NotFoundException('Hostel owner not found');
        await this.prisma.user.update({
          where: { id: owner.id },
          data: { passwordHash, tokenVersion: { increment: 1 } },
        });
        await this.invalidateOwnerSessions(tenantId, owner.id);
        await this.audit(adminId, 'tenant_owner.password_reset', tenantId, {
          method: 'super_admin_set_password',
        }, owner.id);
        return { success: true };
      });
    });
  }

  async updateTenantStatus(adminId: string, tenantId: string, dto: UpdateTenantStatusDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const current = await this.requireTenant(tenantId);
      if (current.status === 'CLOSED' || current.status === 'OFFBOARDING') {
        throw new ConflictException('Closed or offboarding tenants cannot be reactivated or suspended');
      }
      const tenant = await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { status: dto.status },
        select: tenantSelect,
      });
      await this.audit(adminId, `tenant.${dto.status.toLowerCase()}`, tenant.id, {
        previousStatus: current.status,
        status: tenant.status,
      });
      return tenant;
    });
  }

  async listTenantUsers(adminId: string, tenantId: string, filter: TenantUserQueryDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      await this.requireTenant(tenantId);
      return this.prisma.runWithTenantContext(tenantId, async () => {
        const search = filter.search?.trim();
        const where = {
          tenantId,
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { email: { contains: search, mode: 'insensitive' as const } },
                  { phone: { contains: search } },
                  ...( /^[0-9a-f-]{36}$/i.test(search) ? [{ id: search }] : []),
                ],
              }
            : {}),
        };
        const [users, total] = await this.prisma.$transaction([
          this.prisma.user.findMany({
            where,
            select: {
              id: true,
              email: true,
              phone: true,
              status: true,
              createdAt: true,
              userRoles: { select: { role: { select: { id: true, name: true } } } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (filter.page - 1) * filter.pageSize,
            take: filter.pageSize,
          }),
          this.prisma.user.count({ where }),
        ]);
        return this.paginated(users, total, filter);
      });
    });
  }

  async listTenantRoles(adminId: string, tenantId: string) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      await this.requireTenant(tenantId);
      return this.prisma.runWithTenantContext(tenantId, () =>
        this.prisma.role.findMany({
          where: { deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
          select: { id: true, name: true, description: true, isSystemRole: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 100,
        }),
      );
    });
  }

  async updateTenantUser(
    adminId: string,
    tenantId: string,
    userId: string,
    dto: UpdateTenantUserDto,
  ) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      if (dto.status === undefined && dto.roleIds === undefined) {
        throw new BadRequestException('Provide a user status or role assignment to update');
      }
      await this.requireTenant(tenantId);
      return this.prisma.runWithTenantContext(tenantId, async () => {
        const current = await this.prisma.user.findFirst({
          where: { id: userId, tenantId, deletedAt: null },
          select: { id: true, status: true },
        });
        if (!current) throw new NotFoundException('Tenant user not found');

        if (dto.roleIds) {
          const uniqueRoleIds = [...new Set(dto.roleIds)];
          const roles = await this.prisma.role.findMany({
            where: {
              id: { in: uniqueRoleIds },
              deletedAt: null,
              OR: [{ tenantId }, { tenantId: null }],
            },
            select: { id: true },
          });
          if (roles.length !== uniqueRoleIds.length) {
            throw new BadRequestException('Every selected role must be available to this tenant');
          }
          await this.prisma.$transaction(async (tx) => {
            await tx.userRole.deleteMany({ where: { userId, tenantId } });
            if (uniqueRoleIds.length) {
              await tx.userRole.createMany({
                data: uniqueRoleIds.map((roleId) => ({ userId, tenantId, roleId })),
              });
            }
            if (dto.status !== undefined) {
              await tx.user.update({
                where: { id: userId },
                data: {
                  status: dto.status,
                  ...(dto.status !== current.status ? { tokenVersion: { increment: 1 } } : {}),
                },
              });
            }
          });
        } else if (dto.status !== undefined) {
          await this.prisma.user.update({
            where: { id: userId },
            data: {
              status: dto.status,
              ...(dto.status !== current.status ? { tokenVersion: { increment: 1 } } : {}),
            },
          });
        }

        const user = await this.prisma.user.findFirstOrThrow({
          where: { id: userId, tenantId },
          select: {
            id: true,
            email: true,
            phone: true,
            status: true,
            userRoles: { select: { role: { select: { id: true, name: true } } } },
          },
        });
        await this.audit(adminId, 'tenant_user.update', tenantId, {
          userId,
          previousStatus: current.status,
          status: user.status,
          ...(dto.roleIds ? { roleIds: [...new Set(dto.roleIds)] } : {}),
        }, userId);
        return user;
      });
    });
  }

  async listAuditLogs(adminId: string, filter: PlatformPaginationDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.platformAdminAuditLog.findMany({
          where: { platformAdminId: adminId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
          select: {
            id: true,
            action: true,
            targetTenantId: true,
            targetUserId: true,
            metadata: true,
            createdAt: true,
            platformAdmin: { select: { email: true } },
          },
        }),
        this.prisma.platformAdminAuditLog.count({ where: { platformAdminId: adminId } }),
      ]);
      return this.paginated(items, total, filter);
    });
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private findTenantOwner(tenantId: string) {
    return this.prisma.user.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        userRoles: {
          some: {
            tenantId,
            role: { name: 'Owner', isSystemRole: true, deletedAt: null },
          },
        },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async invalidateOwnerSessions(tenantId: string, userId: string) {
    const now = new Date();
    await Promise.all([
      this.prisma.refreshToken.updateMany({
        where: { userId, tenantId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId, tenantId, usedAt: null },
        data: { usedAt: now },
      }),
    ]);
  }

  private validateTenantDetails(dto: CreateTenantDto) {
    if (!dto.name.trim() || !dto.locationAddress.trim()
      || !dto.ownerFirstName.trim() || !dto.ownerLastName.trim()) {
      throw new BadRequestException('Organization, location, and owner names are required');
    }
  }

  private async audit(
    platformAdminId: string,
    action: string,
    targetTenantId: string,
    metadata: Record<string, unknown>,
    targetUserId?: string,
  ) {
    await this.prisma.platformAdminAuditLog.create({
      data: {
        platformAdminId,
        action,
        targetTenantId,
        targetUserId,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  }

  private validateTimezone(timezone?: string) {
    if (!timezone) return;
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      throw new BadRequestException('Timezone must be a valid IANA timezone');
    }
  }

  private paginated<T>(items: T[], total: number, filter: PlatformPaginationDto) {
    return {
      items,
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      pageCount: Math.ceil(total / filter.pageSize),
    };
  }
}