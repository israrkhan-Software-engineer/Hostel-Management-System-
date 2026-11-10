import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { from, lastValueFrom, mergeMap, Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../utils/password.util';
import { RefreshTokenReuseException } from '../exceptions/refresh-token-reuse.exception';
import { SKIP_TENANT_TRANSACTION } from '../decorators/skip-tenant-transaction.decorator';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuthenticatedRequest extends Request {
  user?: { tenantId?: string };
  platformAdminId?: string;
}

type RequestDatabaseContext =
  | { tenantId: string; platformAdminId?: never }
  | { platformAdminId: string; tenantId?: never }
  | null;

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skipTenantTransaction = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_TRANSACTION,
      [context.getHandler(), context.getClass()],
    );
    if (skipTenantTransaction) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    return from(this.resolveDatabaseContext(request)).pipe(
      mergeMap((databaseContext) => databaseContext
        ? from(databaseContext.platformAdminId
          ? this.prisma.runWithPlatformContext(
              databaseContext.platformAdminId,
              () => lastValueFrom(next.handle()),
            )
          : this.prisma.runWithTenantContext(
              databaseContext.tenantId!,
              () => lastValueFrom(next.handle()),
            ).catch(async (error: unknown) => {
              if (error instanceof RefreshTokenReuseException) {
                await this.prisma.runWithIndependentTenantContext(error.tenantId, async () => {
                  await this.prisma.refreshToken.updateMany({
                    where: { userId: error.userId, tenantId: error.tenantId, isRevoked: false },
                    data: { isRevoked: true, revokedAt: new Date() },
                  });
                  await this.prisma.auditLog.create({
                    data: {
                      tenantId: error.tenantId,
                      actorUserId: error.userId,
                      action: 'auth.refresh.reuse_detected',
                      module: 'auth',
                      outcome: 'failure',
                    },
                  });
                });
              }
              throw error;
            }))
        : next.handle()),
    );
  }

  private async resolveDatabaseContext(request: Request): Promise<RequestDatabaseContext> {
    const authenticated = request as AuthenticatedRequest;
    if (authenticated.platformAdminId && UUID_PATTERN.test(authenticated.platformAdminId)) {
      return { platformAdminId: authenticated.platformAdminId };
    }
    const authenticatedTenantId = authenticated.user?.tenantId;
    const path = new URL(request.originalUrl, 'http://localhost').pathname;
    const slug = this.publicHostelSlug(path)
      ?? (path.endsWith('/auth/login') || path.endsWith('/auth/reset-password')
        ? this.bodyString(request, 'tenantSlug')
        : undefined);
    if (slug) {
      const tenantId = await this.prisma.resolvePublicTenantSlug(slug);
      return tenantId ? { tenantId } : null;
    }

    const bootstrapAuthPath = path.endsWith('/auth/login')
      || path.endsWith('/auth/refresh')
      || path.endsWith('/auth/logout')
      || path.endsWith('/auth/reset-password')
      || path.endsWith('/auth/reset-password/complete');
    if (!bootstrapAuthPath && authenticatedTenantId && UUID_PATTERN.test(authenticatedTenantId)) {
      return { tenantId: authenticatedTenantId };
    }

    const token = this.refreshToken(request);
    if (token && (path.endsWith('/auth/refresh') || path.endsWith('/auth/logout'))) {
      const tokenHash = hashToken(token);
      const tenantId = await this.prisma.resolveAuthTokenTenant(tokenHash, async (client) => {
        const record = await client.refreshToken.findUnique({
          where: { tokenHash },
          select: { tenantId: true },
        });
        return record?.tenantId ?? null;
      });
      return tenantId ? { tenantId } : null;
    }

    const resetToken = this.bodyString(request, 'token');
    if (resetToken && path.endsWith('/auth/reset-password/complete')) {
      const tokenHash = hashToken(resetToken);
      const tenantId = await this.prisma.resolveAuthTokenTenant(tokenHash, async (client) => {
        const record = await client.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { tenantId: true },
        });
        return record?.tenantId ?? null;
      });
      return tenantId ? { tenantId } : null;
    }

    return null;
  }

  private publicHostelSlug(path: string): string | undefined {
    const match = path.match(/\/public\/hostels\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  private refreshToken(request: Request): string | undefined {
    const parsedCookie = (request as Request & { cookies?: Record<string, unknown> })
      .cookies?.['hms_refresh'];
    if (typeof parsedCookie === 'string') return parsedCookie;
    return this.bodyString(request, 'refreshToken');
  }

  private bodyString(request: Request, key: string): string | undefined {
    const body = request.body as Record<string, unknown> | undefined;
    return typeof body?.[key] === 'string' ? body[key] as string : undefined;
  }
}