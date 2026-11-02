import { AuthService } from './auth.service';
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

  const activeTenant = {
    id: 'tenant-1', slug: 'test-hostel', status: TenantStatus.ACTIVE, deletedAt: null,
  };
  const suspendedTenant = {
    id: 'tenant-2', slug: 'suspended', status: TenantStatus.SUSPENDED, deletedAt: null,
  };

  beforeEach(async () => {
    mockPrisma = {
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    };

    mockJwt = { sign: jest.fn().mockReturnValue('mock.access.token') };
    mockConfig = { get: jest.fn().mockImplementation((key: string, def?: string) => {
      if (key === 'app.jwtSecret') return 'test-secret';
      if (key === 'app.jwtAccessExpiry') return '15m';
      if (key === 'app.jwtRefreshExpiry') return '7d';
      return def;
    }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
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
      mockPrisma, mockJwt, mockConfig, mockTenants, mockUsers, mockAudit,
    );
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
    expect(mockAudit.log).toHaveBeenCalledWith(
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
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isRevoked: true, revokedAt: expect.any(Date) } }),
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

  it('refresh: reuse detection — already-revoked token revokes ALL sessions', async () => {
    const raw = generateToken();
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', userId: 'user-1', tenantId: 'tenant-1',
      tokenHash: hashToken(raw), isRevoked: true, // already used
      expiresAt: new Date(Date.now() + 100_000),
    });
    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
    // All sessions revoked
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isRevoked: false } }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.refresh.reuse_detected' }),
    );
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
