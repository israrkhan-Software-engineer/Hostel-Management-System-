jest.unmock('@prisma/client');

import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { INestApplication, UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AddressInfo } from 'node:net';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { encryptField } from '../../src/common/utils/field-encryption.util';
import { hashPassword, verifyPassword } from '../../src/common/utils/password.util';
import { PlatformAdminGuard } from '../../src/modules/platform-admin/platform-admin.guard';
import { PlatformAdminController } from '../../src/modules/platform-admin/platform-admin.controller';
import { PlatformAdminService } from '../../src/modules/platform-admin/platform-admin.service';
import { PlatformAuthService } from '../../src/modules/platform-admin/platform-auth.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { UsersService } from '../../src/modules/users/users.service';
import { AuditService } from '../../src/modules/audit/audit.service';

describe('Platform admin authentication (PostgreSQL integration)', () => {
  const runtimeUrl = process.env.DATABASE_URL;
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  const runtimeClient = new PrismaService();
  const adminClient = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
  const adminId = randomUUID();
  const passwordOnlyAdminId = randomUUID();
  const email = `platform-auth-${adminId}@integration.test`;
  const passwordOnlyAdminEmail = `platform-auth-password-only-${passwordOnlyAdminId}@integration.test`;
  const tenantSlug = `integration-${adminId}`;
  const tenantOwnerEmail = `tenant-owner-${adminId}@integration.test`;
  const tenantUserId = randomUUID();
  const tenantUserEmail = `tenant-user-${adminId}@integration.test`;
  const password = 'Integration-test-password-2026';
  const authenticatorSecret = 'JBSWY3DPEHPK3PXP';
  const fieldEncryptionKey = 'integration-test-field-encryption-key';
  const platformJwtSecret = 'integration-test-platform-jwt-secret-2026';
  let app: INestApplication | undefined;
  let baseUrl: string;
  let createdTenantId: string | undefined;
  let adminConnected = false;
  let fixtureCreated = false;

  beforeAll(async () => {
    if (!runtimeUrl || !migrationUrl) {
      throw new Error('DATABASE_URL and DATABASE_MIGRATION_URL are required for PostgreSQL integration tests.');
    }
    const runtimeAddress = new URL(runtimeUrl);
    const migrationAddress = new URL(migrationUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'postgres-test']);
    if (
      runtimeAddress.pathname !== '/hms_test'
      || migrationAddress.pathname !== '/hms_test'
      || !localHosts.has(runtimeAddress.hostname)
      || !localHosts.has(migrationAddress.hostname)
      || process.env.ALLOW_RLS_INTEGRATION_TESTS !== 'true'
    ) {
      throw new Error('Platform admin integration tests only run against the dedicated hms_test database.');
    }

    await adminClient.$connect();
    adminConnected = true;
    await runtimeClient.onModuleInit();

    const config = new ConfigService({
      app: { platformJwtSecret, fieldEncryptionKey },
    });
    const jwt = new JwtService();
    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformAdminController],
      providers: [
        { provide: PrismaService, useValue: runtimeClient },
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
        PlatformAuthService,
        PlatformAdminGuard,
        PlatformAdminService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    await adminClient.platformAdmin.create({
      data: {
        id: adminId,
        email,
        passwordHash: await hashPassword(password),
        mfaSecretEncrypted: encryptField(authenticatorSecret, fieldEncryptionKey),
      },
    });
    await adminClient.platformAdmin.create({
      data: {
        id: passwordOnlyAdminId,
        email: passwordOnlyAdminEmail,
        passwordHash: await hashPassword(password),
        mfaSecretEncrypted: null,
      },
    });
    fixtureCreated = true;
  });

  afterAll(async () => {
    if (adminConnected && fixtureCreated) {
      if (createdTenantId) {
        await adminClient.platformAdminAuditLog.deleteMany({
          where: { platformAdminId: adminId, targetTenantId: createdTenantId },
        });
        await adminClient.auditLog.deleteMany({ where: { tenantId: createdTenantId } });
        await adminClient.refreshToken.deleteMany({ where: { tenantId: createdTenantId } });
        await adminClient.passwordResetToken.deleteMany({ where: { tenantId: createdTenantId } });
        await adminClient.userRole.deleteMany({ where: { tenantId: createdTenantId } });
        await adminClient.rolePermission.deleteMany({ where: { role: { tenantId: createdTenantId } } });
        await adminClient.user.deleteMany({ where: { id: tenantUserId } });
        await adminClient.user.deleteMany({ where: { tenantId: createdTenantId } });
        await adminClient.role.deleteMany({ where: { tenantId: createdTenantId } });
        await adminClient.tenant.deleteMany({ where: { id: createdTenantId } });
      }
      await adminClient.platformAdminAuditLog.deleteMany({ where: { platformAdminId: adminId } });
      await adminClient.platformAdminRecoveryCode.deleteMany({ where: { platformAdminId: adminId } });
      await adminClient.platformAdmin.delete({ where: { id: adminId } });
      await adminClient.platformAdminAuditLog.deleteMany({ where: { platformAdminId: passwordOnlyAdminId } });
      await adminClient.platformAdminRecoveryCode.deleteMany({ where: { platformAdminId: passwordOnlyAdminId } });
      await adminClient.platformAdmin.delete({ where: { id: passwordOnlyAdminId } });
    }
    if (app) await app.close();
    await runtimeClient.onModuleDestroy();
    if (adminConnected) await adminClient.$disconnect();
  });

  it('validates login input and rejects unauthenticated or tenant-scoped management requests', async () => {
    const invalidLogin = await fetchJson('/api/v1/platform/admin/auth/login', 'POST', {});
    expect(invalidLogin.status).toBe(400);

    const anonymousDashboard = await fetchJson('/api/v1/platform/admin/dashboard', 'GET');
    expect(anonymousDashboard.status).toBe(401);

    const tenantToken = await new JwtService().signAsync(
      { sub: adminId, scope: 'tenant', tv: 0 },
      { secret: platformJwtSecret },
    );
    const tenantScopedDashboard = await fetchJson(
      '/api/v1/platform/admin/dashboard',
      'GET',
      undefined,
      tenantToken,
    );
    expect(tenantScopedDashboard.status).toBe(401);

    const invalidCredentials = await fetchJson('/api/v1/platform/admin/auth/login', 'POST', {
      email,
      password: 'wrong-password-for-integration',
    });
    expect(invalidCredentials.status).toBe(401);
  });

  it('authenticates with email and password and authorizes dashboard access', async () => {
    const login = await fetchJson('/api/v1/platform/admin/auth/login', 'POST', {
      email,
      password,
      mfaCode: totpCode(authenticatorSecret),
    });
    expect(login.status).toBe(200);

    expect(login.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: 300,
    });

    const accessToken = login.body.accessToken;
    if (typeof accessToken !== 'string') throw new Error('Platform login did not return an access token.');
    const dashboard = await fetchJson(
      '/api/v1/platform/admin/dashboard',
      'GET',
      undefined,
      accessToken,
    );
    expect(dashboard.status).toBe(200);

    expect(dashboard.body).toEqual(expect.objectContaining({
      tenantCount: expect.any(Number),
      activeTenantCount: expect.any(Number),
      suspendedTenantCount: expect.any(Number),
      totalUsers: expect.any(Number),
      activeUsers: expect.any(Number),
    }));
    if (typeof dashboard.body.tenantCount !== 'number') {
      throw new Error('Dashboard did not return a tenant count.');
    }
    const initialTenantCount = dashboard.body.tenantCount;

    const createdTenant = await fetchJson('/api/v1/platform/admin/tenants', 'POST', {
      name: 'Integration Tenant',
      slug: tenantSlug,
      ownerFirstName: 'Integration',
      ownerLastName: 'Owner',
      ownerEmail: tenantOwnerEmail,
      locationAddress: '12 Integration Road',
      ownerPassword: 'Integration-owner-password-2026!',
      ownerPasswordConfirmation: 'Integration-owner-password-2026!',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    }, accessToken);
    if (createdTenant.status !== 201) {
      throw new Error(`Tenant creation failed (${createdTenant.status}): ${JSON.stringify(createdTenant.body)}`);
    }
    if (typeof createdTenant.body.id !== 'string') {
      throw new Error('Tenant creation response did not contain an id.');
    }
    createdTenantId = createdTenant.body.id;
    expect(createdTenant.body.status).toBe('PROVISIONING');

    const dashboardAfterCreate = await fetchJson(
      '/api/v1/platform/admin/dashboard',
      'GET',
      undefined,
      accessToken,
    );
    expect(dashboardAfterCreate.body.tenantCount).toBe(initialTenantCount + 1);

    const listedTenants = await fetchJson(
      `/api/v1/platform/admin/tenants?search=${tenantSlug}&page=1&pageSize=10`,
      'GET',
      undefined,
      accessToken,
    );
    expect(listedTenants.status).toBe(200);
    expect(JSON.stringify(listedTenants.body)).toContain(tenantSlug);

    const details = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}`,
      'GET',
      undefined,
      accessToken,
    );
    expect(details.status).toBe(200);
    expect(details.body).toEqual(expect.objectContaining({
      slug: tenantSlug,
      locationAddress: '12 Integration Road',
      owner: expect.objectContaining({
        firstName: 'Integration',
        lastName: 'Owner',
        email: tenantOwnerEmail,
      }),
    }));

    const owner = await adminClient.user.findFirstOrThrow({
      where: { tenantId: createdTenantId, email: tenantOwnerEmail },
    });
    expect(owner.passwordHash).not.toContain('Integration-owner-password-2026!');
    await expect(verifyPassword('Integration-owner-password-2026!', owner.passwordHash)).resolves.toBe(true);

    const duplicateSlug = await fetchJson('/api/v1/platform/admin/tenants', 'POST', {
      name: 'Duplicate Slug Tenant',
      slug: tenantSlug,
      ownerFirstName: 'Another',
      ownerLastName: 'Owner',
      ownerEmail: `duplicate-${adminId}@integration.test`,
      locationAddress: '13 Integration Road',
      ownerPassword: 'Integration-owner-password-2026!',
      ownerPasswordConfirmation: 'Integration-owner-password-2026!',
    }, accessToken);
    expect(duplicateSlug.status).toBe(409);
    expect(await adminClient.tenant.count({ where: { slug: tenantSlug } })).toBe(1);

    await adminClient.user.create({
      data: {
        id: tenantUserId,
        tenantId: createdTenantId,
        email: tenantUserEmail,
        passwordHash: 'test-fixture-hash',
      },
    });

    const duplicateOwnerEmail = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}`,
      'PATCH',
      { ownerEmail: tenantUserEmail },
      accessToken,
    );
    expect(duplicateOwnerEmail.status).toBe(409);
    expect((await adminClient.user.findUniqueOrThrow({ where: { id: owner.id } })).email)
      .toBe(tenantOwnerEmail);

    const updatedTenant = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}`,
      'PATCH',
      {
        name: 'Updated Integration Tenant',
        slug: `updated-${tenantSlug}`,
        ownerFirstName: 'Updated',
        ownerLastName: 'Owner',
        ownerEmail: `updated-${tenantOwnerEmail}`,
        locationAddress: '22 Updated Integration Road',
      },
      accessToken,
    );
    expect(updatedTenant.status).toBe(200);
    expect(updatedTenant.body.name).toBe('Updated Integration Tenant');
    expect(updatedTenant.body.slug).toBe(`updated-${tenantSlug}`);
    expect(updatedTenant.body.locationAddress).toBe('22 Updated Integration Road');

    const updatedDetails = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}`,
      'GET',
      undefined,
      accessToken,
    );
    expect(updatedDetails.body).toEqual(expect.objectContaining({
      owner: expect.objectContaining({
        firstName: 'Updated',
        lastName: 'Owner',
        email: `updated-${tenantOwnerEmail}`,
      }),
      locationAddress: '22 Updated Integration Road',
    }));

    const updatedOwner = await adminClient.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(updatedOwner.tokenVersion).toBe(1);
    expect(await adminClient.refreshToken.count({ where: { userId: owner.id, isRevoked: true } })).toBe(0);

    const resetOwnerPassword = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}/owner/password`,
      'POST',
      {
        newPassword: 'New-integration-owner-password-2026!',
        confirmation: 'New-integration-owner-password-2026!',
      },
      accessToken,
    );
    expect(resetOwnerPassword.status).toBe(201);
    expect(resetOwnerPassword.body).toEqual({ success: true });
    const ownerAfterReset = await adminClient.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(ownerAfterReset.tokenVersion).toBe(2);
    expect(ownerAfterReset.passwordHash).not.toContain('New-integration-owner-password-2026!');
    await expect(verifyPassword('New-integration-owner-password-2026!', ownerAfterReset.passwordHash))
      .resolves.toBe(true);
    const resetAudit = await adminClient.platformAdminAuditLog.findFirstOrThrow({
      where: {
        platformAdminId: adminId,
        targetTenantId: createdTenantId,
        targetUserId: owner.id,
        action: 'tenant_owner.password_reset',
      },
      select: { metadata: true },
    });
    expect(resetAudit.metadata).toEqual({ method: 'super_admin_set_password' });

    const unauthenticatedCreate = await fetchJson('/api/v1/platform/admin/tenants', 'POST', {
      name: 'Unauthorized Tenant',
      slug: `unauthorized-${adminId}`,
    });
    expect(unauthenticatedCreate.status).toBe(401);
    const unauthenticatedEdit = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}`,
      'PATCH',
      { name: 'Unauthorized Update' },
    );
    expect(unauthenticatedEdit.status).toBe(401);
    const unauthenticatedPasswordReset = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}/owner/password`,
      'POST',
      {
        newPassword: 'Unauthorized-owner-password-2026!',
        confirmation: 'Unauthorized-owner-password-2026!',
      },
    );
    expect(unauthenticatedPasswordReset.status).toBe(401);

    const listedUsers = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}/users?search=${tenantUserEmail}`,
      'GET',
      undefined,
      accessToken,
    );
    expect(listedUsers.status).toBe(200);
    expect(listedUsers.body).toEqual(expect.objectContaining({
      total: 1,
      items: expect.arrayContaining([
        expect.objectContaining({ id: tenantUserId, email: tenantUserEmail, status: 'ACTIVE' }),
      ]),
    }));

    const deactivatedUser = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}/users/${tenantUserId}`,
      'PATCH',
      { status: 'DEACTIVATED' },
      accessToken,
    );
    expect(deactivatedUser.status).toBe(200);
    expect(deactivatedUser.body.status).toBe('DEACTIVATED');
    expect((await adminClient.user.findUniqueOrThrow({ where: { id: tenantUserId } })).tokenVersion).toBe(1);

    for (const status of ['ACTIVE', 'SUSPENDED', 'ACTIVE']) {
      const statusChange = await fetchJson(
        `/api/v1/platform/admin/tenants/${createdTenantId}/status`,
        'PATCH',
        { status },
        accessToken,
      );
      expect(statusChange.status).toBe(200);
      expect(statusChange.body.status).toBe(status);
    }

    const tenantAuth = new AuthService(
      runtimeClient,
      new JwtService({ secret: 'integration-tenant-jwt-secret-2026' }),
      new ConfigService({
        app: {
          jwtSecret: 'integration-tenant-jwt-secret-2026',
          jwtAccessExpiry: '15m',
          jwtRefreshExpiry: '7d',
        },
      }),
      new TenantsService(runtimeClient),
      new UsersService(runtimeClient),
      new AuditService(runtimeClient),
    );
    const authenticatedOwner = await runtimeClient.runWithTenantContext(createdTenantId, () =>
      tenantAuth.login({
        tenantSlug: `updated-${tenantSlug}`,
        login: `updated-${tenantOwnerEmail}`,
        password: 'New-integration-owner-password-2026!',
      }),
    );
    expect(authenticatedOwner).toEqual(expect.objectContaining({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    }));
    const tenantTokenEdit = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}`,
      'PATCH',
      { name: 'Tenant Account Must Not Edit Platform Data' },
      authenticatedOwner.accessToken,
    );
    expect(tenantTokenEdit.status).toBe(401);
    const tenantTokenPasswordReset = await fetchJson(
      `/api/v1/platform/admin/tenants/${createdTenantId}/owner/password`,
      'POST',
      {
        newPassword: 'Unauthorized-owner-password-2026!',
        confirmation: 'Unauthorized-owner-password-2026!',
      },
      authenticatedOwner.accessToken,
    );
    expect(tenantTokenPasswordReset.status).toBe(401);
    await expect(runtimeClient.runWithTenantContext(createdTenantId, () =>
      tenantAuth.login({
        tenantSlug: `updated-${tenantSlug}`,
        login: `updated-${tenantOwnerEmail}`,
        password: 'Integration-owner-password-2026!',
      }),
    )).rejects.toThrow(UnauthorizedException);

    const tenantAudit = await adminClient.platformAdminAuditLog.findMany({
      where: { platformAdminId: adminId, targetTenantId: createdTenantId },
      select: { action: true },
    });
    expect(tenantAudit.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'tenant.create',
      'tenant.update',
      'tenant_owner.password_reset',
      'tenant.active',
      'tenant.suspended',
    ]));

  });

  it('enrolls MFA for new admins and then requires an authenticator code at login', async () => {
    const login = await fetchJson('/api/v1/platform/admin/auth/login', 'POST', {
      email: passwordOnlyAdminEmail,
      password,
    });
    expect(login.status).toBe(200);
    expect(login.body.mfaEnrollmentRequired).toBe(true);
    expect(typeof login.body.enrollmentToken).toBe('string');
    expect(typeof login.body.authenticatorUri).toBe('string');

    const enrollmentToken = login.body.enrollmentToken;
    const authenticatorUriValue = login.body.authenticatorUri;
    if (typeof enrollmentToken !== 'string' || typeof authenticatorUriValue !== 'string') {
      throw new Error('MFA enrollment response did not contain setup details.');
    }
    const secret = new URL(authenticatorUriValue).searchParams.get('secret');
    if (!secret) throw new Error('Authenticator URI did not contain a secret.');

    const enrollment = await fetchJson('/api/v1/platform/admin/auth/enroll-mfa', 'POST', {
      enrollmentToken,
      code: totpCode(secret),
    });
    expect(enrollment.status).toBe(200);
    expect(enrollment.body.recoveryCodes).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(typeof enrollment.body.accessToken).toBe('string');
    const enrollmentAccessToken = enrollment.body.accessToken;
    if (typeof enrollmentAccessToken !== 'string') {
      throw new Error('MFA enrollment did not return a platform access token.');
    }
    const dashboard = await fetchJson(
      '/api/v1/platform/admin/dashboard',
      'GET',
      undefined,
      enrollmentAccessToken,
    );
    expect(dashboard.status).toBe(200);

    const missingCodeLogin = await fetchJson('/api/v1/platform/admin/auth/login', 'POST', {
      email: passwordOnlyAdminEmail,
      password,
    });
    expect(missingCodeLogin.status).toBe(401);

    const enrolledLogin = await fetchJson('/api/v1/platform/admin/auth/login', 'POST', {
      email: passwordOnlyAdminEmail,
      password,
      mfaCode: totpCode(secret),
    });
    expect(enrolledLogin.status).toBe(200);
    expect(enrolledLogin.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: 300,
    });
  });

  it('denies tenant registry writes under a deactivated platform-admin context', async () => {
    const slug = `inactive-${randomUUID()}`;
    await adminClient.platformAdmin.update({
      where: { id: adminId },
      data: { status: 'DEACTIVATED' },
    });

    try {
      await expect(runtimeClient.runWithPlatformContext(adminId, () =>
        runtimeClient.tenant.create({
          data: { name: 'Must Not Exist', slug },
        }),
      )).rejects.toThrow();

      expect(await adminClient.tenant.count({ where: { slug } })).toBe(0);
    } finally {
      await adminClient.platformAdmin.update({
        where: { id: adminId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  async function fetchJson(
    path: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: Record<string, string>,
    token?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    };
  }

  function totpCode(secret: string, now = Date.now()): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let buffer = 0;
    let bits = 0;
    const bytes: number[] = [];
    for (const character of secret) {
      buffer = (buffer << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bytes.push((buffer >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
    const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = digest.readUInt32BE(offset) & 0x7fffffff;
    return String(binary % 1_000_000).padStart(6, '0');
  }
});
