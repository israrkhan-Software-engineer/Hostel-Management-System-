import { Injectable, OnModuleInit, OnModuleDestroy, Logger, ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantTransactionContext {
  tenantId?: string;
  platformAdminId?: string;
  platformLoginEmail?: string;
  client: Prisma.TransactionClient;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly tenantTransaction = new AsyncLocalStorage<TenantTransactionContext>();

  constructor() {
    super({
      datasources: {
        db: { url: databaseUrlWithPoolLimit() },
      },
      log: process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'info', 'warn', 'error']
        : ['warn', 'error'],
    });

    return new Proxy(this, {
      get: (target, property, receiver) => {
        const context = target.tenantTransaction.getStore();
        if (property === '$transaction' && context) {
          return (operation: unknown) => typeof operation === 'function'
            ? (operation as (client: Prisma.TransactionClient) => unknown)(context.client)
            : Promise.all(operation as Promise<unknown>[]);
        }

        if (!context || property === 'tenantTransaction' || property === 'logger'
          || property === 'onModuleInit' || property === 'onModuleDestroy'
          || property === 'runWithTenantContext' || property === 'runWithPlatformContext'
          || property === 'runWithIndependentTenantContext'
          || property === 'runWithPlatformLoginContext' || property === 'resolveAuthTokenTenant'
          || property === 'resolvePublicTenantSlug') {
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        const value = Reflect.get(context.client, property, context.client);
        return typeof value === 'function' ? value.bind(context.client) : value;
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.assertRuntimeRole();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async runWithTenantContext<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new ForbiddenException('A valid tenant context is required');
    }

    const active = this.tenantTransaction.getStore();
    if (active) {
      if (active.platformAdminId) {
        const previousTenantId = active.tenantId;
        await active.client.$queryRaw`SELECT set_config('hms.current_tenant_id', ${tenantId}, TRUE)`;
        active.tenantId = tenantId;
        try {
          return await operation();
        } finally {
          await active.client.$queryRaw`SELECT set_config('hms.current_tenant_id', ${previousTenantId ?? ''}, TRUE)`;
          active.tenantId = previousTenantId;
        }
      }

      if (active.tenantId !== tenantId) {
        throw new ForbiddenException('Tenant context cannot change within a request');
      }
      return operation();
    }

    return this.$transaction(async (client) => {
      await client.$queryRaw`SELECT set_config('hms.current_tenant_id', ${tenantId}, TRUE)`;
      return this.tenantTransaction.run({ tenantId, client }, operation);
    }, { timeout: 30_000 });
  }

  async runWithIndependentTenantContext<T>(
    tenantId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new ForbiddenException('A valid tenant context is required');
    }

    return this.tenantTransaction.exit(() => this.$transaction(async (client) => {
      await client.$queryRaw`SELECT set_config('hms.current_tenant_id', ${tenantId}, TRUE)`;
      return this.tenantTransaction.run({ tenantId, client }, operation);
    }, { timeout: 30_000 }));
  }

  async runWithPlatformContext<T>(platformAdminId: string, operation: () => Promise<T>): Promise<T> {
    if (!UUID_PATTERN.test(platformAdminId)) {
      throw new ForbiddenException('A valid platform administrator context is required');
    }

    const active = this.tenantTransaction.getStore();
    if (active) {
      if (active.platformAdminId === platformAdminId) return operation();
      if (active.platformLoginEmail && !active.platformAdminId) {
        await active.client.$queryRaw`SELECT set_config('hms.platform_admin_id', ${platformAdminId}, TRUE)`;
        active.platformAdminId = platformAdminId;
        return operation();
      }
      throw new ForbiddenException('Platform context cannot replace a different request context');
    }

    return this.$transaction(async (client) => {
      await client.$queryRaw`SELECT set_config('hms.platform_admin_id', ${platformAdminId}, TRUE)`;
      return this.tenantTransaction.run({ platformAdminId, client }, operation);
    }, { timeout: 30_000 });
  }

  async runWithPlatformLoginContext<T>(email: string, operation: () => Promise<T>): Promise<T> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) throw new ForbiddenException('A platform login identity is required');
    return this.$transaction(async (client) => {
      await client.$queryRaw`SELECT set_config('hms.platform_login_email', ${normalizedEmail}, TRUE)`;
      return this.tenantTransaction.run({ platformLoginEmail: normalizedEmail, client }, operation);
    }, { timeout: 30_000 });
  }

  async resolveAuthTokenTenant(
    tokenHash: string,
    resolve: (client: Prisma.TransactionClient) => Promise<string | null>,
  ): Promise<string | null> {
    return this.$transaction(async (client) => {
      await client.$queryRaw`SELECT set_config('hms.auth_token_hash', ${tokenHash}, TRUE)`;
      return resolve(client);
    });
  }

  async resolvePublicTenantSlug(slug: string): Promise<string | null> {
    return this.$transaction(async (client) => {
      await client.$queryRaw`SELECT set_config('hms.tenant_slug', ${slug}, TRUE)`;
      const tenant = await client.tenant.findUnique({
        where: { slug },
        select: { id: true },
      });
      return tenant?.id ?? null;
    });
  }

  private async assertRuntimeRole(): Promise<void> {
    const [role] = await this.$queryRaw<Array<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      inherits_rls_bypass: boolean;
    }>>`
      SELECT runtime_role.rolsuper, runtime_role.rolbypassrls,
        EXISTS (
          SELECT 1 FROM pg_roles AS elevated_role
          WHERE (elevated_role.rolsuper OR elevated_role.rolbypassrls)
            AND pg_has_role(current_user, elevated_role.oid, 'MEMBER')
        ) AS inherits_rls_bypass
      FROM pg_roles AS runtime_role
      WHERE runtime_role.rolname = current_user
    `;
    if (!role || role.rolsuper || role.rolbypassrls || role.inherits_rls_bypass) {
      throw new Error('The HMS runtime database role must not be a superuser or have BYPASSRLS.');
    }
  }

}

function databaseUrlWithPoolLimit(): string {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return '';
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? '10');
  if (!Number.isSafeInteger(poolMax) || poolMax < 1) {
    throw new Error('DATABASE_POOL_MAX must be a positive integer.');
  }
  const url = new URL(rawUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(poolMax));
  }
  return url.toString();
}
