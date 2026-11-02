import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * L2 Tenant guard — confirms the tenant in the JWT matches an ACTIVE tenant
 * and sets the PostgreSQL RLS context for this request.
 *
 * Every query after this point is backstopped by RLS so that even a bug
 * in application-level scoping cannot leak another tenant's data.
 * SRS V2 §13.3, SECURITY §5.1 L2, L6.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      user?: { userId: string; tenantId: string };
      tenant?: { id: string; status: string };
    }>();

    if (!req.user?.tenantId || !UUID_PATTERN.test(req.user.tenantId)) {
      throw new ForbiddenException('A valid tenant context is required');
    }

    const tenant = await this.prisma.runWithTenantContext(req.user.tenantId, () =>
      this.prisma.tenant.findUnique({
        where: { id: req.user!.tenantId },
        select: { id: true, status: true, deletedAt: true },
      }),
    );

    if (!tenant || tenant.deletedAt) {
      throw new ForbiddenException('Tenant not found');
    }

    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('This hostel account is suspended');
    }
    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('This hostel account is not active');
    }

    // Attach tenant to request for downstream use
    req.tenant = tenant;

    return true;
  }
}
