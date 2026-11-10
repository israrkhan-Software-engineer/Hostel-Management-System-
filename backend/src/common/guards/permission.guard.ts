import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesService } from '../../modules/roles/roles.service';
import { PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

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
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      throw new ForbiddenException('This endpoint does not declare a required permission');
    }

    const req = context.switchToHttp().getRequest<{
      user?: { userId: string; tenantId: string };
    }>();
    if (!req.user) return false;

    const { userId, tenantId } = req.user;
    let accessDenial = '';
    const allowed = await this.prisma.runWithTenantContext(
      tenantId,
      async () => {
        const hasPermission = await this.roles.userHasPermission(
          userId,
          tenantId,
          required.module,
          required.action,
        );
        if (!hasPermission) return false;
        const subscription = await this.prisma.tenantSubscription.findFirst({
          where: {
            tenantId,
            status: { in: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { plan: { select: { features: true } } },
        });
        if (!subscription) {
          accessDenial = 'Subscription expired. Contact your hostel owner to upgrade.';
          return false;
        }
        if (subscription.status === SubscriptionStatus.SUSPENDED) {
          accessDenial = 'Subscription is suspended. Contact platform support.';
          return false;
        }
        const expiry = subscription.status === SubscriptionStatus.TRIAL
          ? subscription.trialEndsAt
          : subscription.periodEndsAt;
        if (expiry && expiry <= new Date()) {
          await this.prisma.tenantSubscription.update({
            where: { id: subscription.id },
            data: { status: SubscriptionStatus.EXPIRED },
          });
          accessDenial = 'Subscription expired. Contact your hostel owner to renew.';
          return false;
        }
        const features = subscription.plan.features;
        if (
          !features
          || typeof features !== 'object'
          || Array.isArray(features)
          || (features as Record<string, unknown>)[required.module] !== true
        ) {
          accessDenial = `The ${required.module} feature is not included in this subscription plan.`;
          return false;
        }
        return true;
      },
    );

    if (!allowed && accessDenial) {
      throw new ForbiddenException(accessDenial);
    }
    if (!allowed) {
      throw new ForbiddenException(`Permission denied: ${required.module}.${required.action}`);
    }
    return true;
  }
}
