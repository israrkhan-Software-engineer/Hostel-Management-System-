import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionAction } from '@prisma/client';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if a user holds a specific permission (module + action) in a tenant.
   * This is the single source of truth for authorization — used by PermissionGuard.
   * SRS V2 §3, FR-112, SECURITY §5.
   */
  async userHasPermission(
    userId: string,
    tenantId: string,
    module: string,
    action: PermissionAction,
  ): Promise<boolean> {
    const count = await this.prisma.userRole.count({
      where: {
        userId,
        tenantId,
        role: {
          deletedAt: null,
          permissions: {
            some: {
              permission: { module, action },
            },
          },
        },
      },
    });
    return count > 0;
  }

  /** Collect all permissions a user has in a tenant — used to build permission set */
  async getUserPermissions(
    userId: string,
    tenantId: string,
  ): Promise<Array<{ module: string; action: PermissionAction }>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, tenantId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    const perms = new Map<string, { module: string; action: PermissionAction }>();
    for (const ur of userRoles) {
      for (const rp of ur.role.permissions) {
        const key = `${rp.permission.module}:${rp.permission.action}`;
        perms.set(key, { module: rp.permission.module, action: rp.permission.action });
      }
    }
    return Array.from(perms.values());
  }

  /** Seed the 10 base permission types for a module (used by seed script) */
  async ensurePermissions(modules: string[]): Promise<void> {
    const actions: PermissionAction[] = [
      'view', 'create', 'edit', 'delete', 'approve',
      'export', 'print', 'assign', 'verify', 'manage_settings',
    ];
    for (const module of modules) {
      for (const action of actions) {
        await this.prisma.permission.upsert({
          where: { module_action: { module, action } },
          update: {},
          create: { module, action },
        });
      }
    }
  }
}
