import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

import { hashPassword, hashToken, generateToken } from '../../common/utils/password.util';

// Local constants matching schema.prisma enums (avoids ts-jest Prisma binary dependency)
const UserStatus = { ACTIVE: "ACTIVE", DEACTIVATED: "DEACTIVATED" } as const;
const TenantStatus = { ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", PROVISIONING: "PROVISIONING", OFFBOARDING: "OFFBOARDING", CLOSED: "CLOSED" } as const;


/**
 * Auth service unit tests — Phase 1 exit criteria:
 * ✅ Login: valid credentials → tokens issued
 * ✅ Login: invalid password → 401
 * ✅ Login: deactivated user → 401 immediately
 * ✅ Login: suspended tenant → 403
 * ✅ Refresh rotation: valid token → new pair, old revoked
 * ✅ Refresh reuse: already-revoked token → 401 + all sessions revoked
 * ✅ Logout: token revoked
 * ✅ tokenVersion mismatch → token rejected (instant deactivation)
 */
describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockConfig: any;
  let mockTenants: any;
  let mockUsers: any;
  let mockAudit: any;
  let mockNotifications: any;

  const activeTenant = {
    id: 'tenant-1', slug: 'test-hostel', status: TenantStatus.ACTIVE, deletedAt: null,
  };
  const suspendedTenant = {
    id: 'tenant-2', slug: 'suspended', status: TenantStatus.SUSPENDED, deletedAt: null,
  };

  beforeEach(async () => {
    mockPrisma = {
      user: { update: jest.fn().mockResolvedValue({}) },
      tenant: { findFirst: jest.fn().mockResolvedValue(activeTenant) },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      runWithIndependentTenantContext: jest.fn((_tenantId: string, operation: () => Promise<unknown>) => operation()),
      $executeRaw: jest.fn().mockResolvedValue([{ failed_login_attempts: 1 }]),
      passwordResetToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    };

    mockJwt = { sign: jest.fn().mockReturnValue('mock.access.token') };
    mockNotifications = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      enqueueDelivery: jest.fn().mockResolvedValue(undefined),
    };
    mockConfig = { get: jest.fn().mockImplementation((key: string, def?: string) => {
      if (key === 'app.jwtSecret') return 'test-secret';
      if (key === 'app.jwtAccessExpiry') return '15m';
      if (key === 'app.jwtRefreshExpiry') return '7d';
      if (key === 'app.frontendUrl') return 'https://app.example.test';
      return def;
    }) };
    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
      logOrThrow: jest.fn().mockResolvedValue(undefined),
      logDurably: jest.fn().mockResolvedValue(undefined),
    };
    mockTenants = {
      findBySlug: jest.fn().mockResolvedValue(activeTenant),
      isActive: jest.fn().mockReturnValue(true),
      isSuspended: jest.fn().mockReturnValue(false),
    };
    mockUsers = {
      findByEmail: jest.fn(),
      findByPhone: jest.fn(),
      findById: jest.fn(),
      incrementTokenVersion: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      mockPrisma, mockJwt, mockConfig, mockTenants, mockUsers, mockAudit, mockNotifications,
    );
  });

  it('login dto trims surrounding whitespace before validation', async () => {
    const dto = plainToInstance(LoginDto, {
      tenantSlug: '  test-hostel  ',
      login: '  owner@test.com  ',
      password: '  correctpass123!  ',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.tenantSlug).toBe('test-hostel');
    expect(dto.login).toBe('owner@test.com');
    expect(dto.password).toBe('correctpass123!');
  });

  it('initiatePasswordReset sends both email and SMS via the notification service when contact methods exist', async () => {
    mockUsers.findByEmail.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'owner@test.com',
      phone: '+923001234567',
    });

    await service.initiatePasswordReset('tenant-1', 'owner@test.com');

    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      category: 'account_security',
      email: expect.objectContaining({ to: 'owner@test.com' }),
      sms: expect.objectContaining({ to: '+923001234567' }),
      deduplicationKey: expect.stringContaining('password-reset:user-1:'),
    }));
  });

  // ── Login ─────────────────────────────────────────────────────────────────

  it('login: valid credentials → access + refresh token', async () => {
    const passwordHash = await hashPassword('correct');
    mockUsers.findByEmail.mockResolvedValue({
      id: 'user-1', passwordHash, status: UserStatus.ACTIVE, tokenVersion: 0,
    });
    const result = await service.login({
      tenantSlug: 'test-hostel', login: 'owner@test.com', password: 'correct',
    });
    expect(result.accessToken).toBe('mock.access.token');
    expect(result.refreshToken).toBeTruthy();
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.success', outcome: 'success' }),
    );
  });

  it('login: wrong password → 401', async () => {
    const passwordHash = await hashPassword('correct');
    mockUsers.findByEmail.mockResolvedValue({
      id: 'user-1', passwordHash, status: UserStatus.ACTIVE, tokenVersion: 0,
    });
    await expect(
      service.login({ tenantSlug: 'test-hostel', login: 'owner@test.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockAudit.logOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failed', outcome: 'failure' }),
    );
  });

  it('login: unknown user → 401 (no user enumeration)', async () => {
    mockUsers.findByEmail.mockResolvedValue(null);
    await expect(
      service.login({ tenantSlug: 'test-hostel', login: 'nobody@test.com', password: 'any' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login: deactivated user → 401 immediately (SRS V2 FR-116)', async () => {
    const passwordHash = await hashPassword('correct');
    mockUsers.findByEmail.mockResolvedValue({
      id: 'user-1', passwordHash, status: UserStatus.DEACTIVATED, tokenVersion: 0,
    });
    await expect(
      service.login({ tenantSlug: 'test-hostel', login: 'owner@test.com', password: 'correct' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login: suspended tenant → 403', async () => {
    mockTenants.findBySlug.mockResolvedValue(suspendedTenant);
    mockTenants.isActive.mockReturnValue(false);
    mockTenants.isSuspended.mockReturnValue(true);
    await expect(
      service.login({ tenantSlug: 'suspended', login: 'x@x.com', password: 'y' }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── Refresh rotation ──────────────────────────────────────────────────────

  it('refresh: valid token → new pair issued, old revoked', async () => {
    const raw = generateToken();
    const tokenHash = hashToken(raw);
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', userId: 'user-1', tenantId: 'tenant-1',
      tokenHash, isRevoked: false, expiresAt: new Date(Date.now() + 100_000),
    });
    mockUsers.findById.mockResolvedValue({
      id: 'user-1', status: UserStatus.ACTIVE, tokenVersion: 0,
    });
    const result = await service.refresh(raw);
    expect(result.accessToken).toBeTruthy();
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rt-1', isRevoked: false }),
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      }),
    );
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1); // new token created
  });

  it('refresh: expired token → 401', async () => {
    const raw = generateToken();
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', userId: 'user-1', tenantId: 'tenant-1',
      tokenHash: hashToken(raw), isRevoked: false,
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: reuse detection is escalated for independent session revocation', async () => {
    const raw = generateToken();
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', userId: 'user-1', tenantId: 'tenant-1',
      tokenHash: hashToken(raw), isRevoked: true, // already used
      expiresAt: new Date(Date.now() + 100_000),
    });
    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('refresh: inactive tenant cannot renew a session', async () => {
    const raw = generateToken();
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', userId: 'user-1', tenantId: 'tenant-1',
      tokenHash: hashToken(raw), isRevoked: false, expiresAt: new Date(Date.now() + 100_000),
    });
    mockPrisma.tenant.findFirst.mockResolvedValue(suspendedTenant);
    mockTenants.isActive.mockReturnValue(false);

    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
    expect(mockUsers.findById).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('refresh: non-existent token → 401', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.refresh('fake-token')).rejects.toThrow(UnauthorizedException);
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  it('logout: revokes the refresh token', async () => {
    const raw = generateToken();
    await service.logout(raw);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: hashToken(raw), isRevoked: false },
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      }),
    );
  });

  // ── validateAccessToken (instant deactivation via tokenVersion) ───────────

  it('validateAccessToken: matching tokenVersion → valid', async () => {
    mockUsers.findById.mockResolvedValue({
      id: 'u1', tenantId: 'tenant-1', status: UserStatus.ACTIVE, tokenVersion: 3,
    });
    const result = await service.validateAccessToken({
      sub: 'u1', tid: 'tenant-1', tv: 3,
    });
    expect(result).toEqual({ userId: 'u1', tenantId: 'tenant-1' });
  });

  it('validateAccessToken: tokenVersion mismatch → null (deactivated mid-session)', async () => {
    mockUsers.findById.mockResolvedValue({
      id: 'u1', tenantId: 'tenant-1', status: UserStatus.ACTIVE, tokenVersion: 5, // DB incremented
    });
    const result = await service.validateAccessToken({
      sub: 'u1', tid: 'tenant-1', tv: 3, // stale token
    });
    expect(result).toBeNull();
  });

  it('validateAccessToken: rejects a user from a different tenant', async () => {
    mockUsers.findById.mockResolvedValue({
      id: 'u1', tenantId: 'tenant-2', status: UserStatus.ACTIVE, tokenVersion: 3,
    });
    const result = await service.validateAccessToken({ sub: 'u1', tid: 'tenant-1', tv: 3 });
    expect(result).toBeNull();
  });

  it('validateAccessToken: deactivated user → null', async () => {
    mockUsers.findById.mockResolvedValue({
      id: 'u1', tenantId: 'tenant-1', status: UserStatus.DEACTIVATED, tokenVersion: 0,
    });
    const result = await service.validateAccessToken({ sub: 'u1', tid: 'tenant-1', tv: 0 });
    expect(result).toBeNull();
  });
});
