import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesService } from '../../modules/roles/roles.service';
import { PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * L4 Permission guard — checks module+action permission in the user's tenant.
 * SRS V2 FR-112, §3 / SECURITY §5.1 L4.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private roles: RolesService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{
      user?: { userId: string; tenantId: string };
    }>();
    if (!req.user) return false;

    const { userId, tenantId } = req.user;
    const hasPermission = await this.prisma.runWithTenantContext(
      tenantId,
      () => this.roles.userHasPermission(userId, tenantId, required.module, required.action as any),
    );

    if (!hasPermission) {
      throw new ForbiddenException(`Permission denied: ${required.module}.${required.action}`);
    }
    return true;
  }
}
