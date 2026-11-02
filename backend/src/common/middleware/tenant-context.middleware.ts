import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { from, lastValueFrom, mergeMap, Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../utils/password.util';

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
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
            ))
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
    const bodyToken = this.bodyString(request, 'refreshToken');
    if (bodyToken) return bodyToken;
    const cookie = request.headers.cookie?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('hms_refresh='));
    return cookie ? decodeURIComponent(cookie.slice('hms_refresh='.length)) : undefined;
  }

  private bodyString(request: Request, key: string): string | undefined {
    const body = request.body as Record<string, unknown> | undefined;
    return typeof body?.[key] === 'string' ? body[key] as string : undefined;
  }
}