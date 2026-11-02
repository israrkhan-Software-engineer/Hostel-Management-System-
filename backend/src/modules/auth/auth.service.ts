import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import {
  verifyPassword,
  hashToken,
  generateToken,
} from '../../common/utils/password.util';
import { UserStatus } from '@prisma/client';

export interface JwtPayload {
  sub: string;       // userId
  tid: string;       // tenantId
  tv: number;        // tokenVersion — must match DB; used for instant deactivation
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private tenants: TenantsService,
    private users: UsersService,
    private audit: AuditService,
  ) {}

  /**
   * Login — validates credentials, checks tenant is ACTIVE, issues tokens.
   * SRS V2 FR-112, FR-113 / SECURITY §3.
   */
  async login(dto: {
    tenantSlug: string;
    login: string;       // email or phone
    password: string;
    deviceInfo?: string;
    ip?: string;
  }): Promise<AuthTokens> {
    // 1. Resolve tenant
    const tenant = await this.tenants.findBySlug(dto.tenantSlug);
    if (!this.tenants.isActive(tenant)) {
      throw new ForbiddenException(
        this.tenants.isSuspended(tenant)
          ? 'This hostel account is temporarily suspended'
          : 'This hostel account is not active',
      );
    }

    // 2. Find user by email or phone
    const isEmail = dto.login.includes('@');
    const user = isEmail
      ? await this.users.findByEmail(tenant.id, dto.login)
      : await this.users.findByPhone(tenant.id, dto.login);

    // 3. Verify password — always run verify even on null user to avoid timing attack
    const dummyHash = 'pbkdf2:100000:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = user
      ? await verifyPassword(dto.password, user.passwordHash)
      : await verifyPassword(dto.password, dummyHash);

    if (!user || !valid) {
      await this.audit.log({
        tenantId: tenant.id,
        action: 'auth.login.failed',
        module: 'auth',
        outcome: 'failure',
        metadata: { login: dto.login, ip: dto.ip },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Check user is ACTIVE — deactivated users are denied immediately (SRS V2 FR-116)
    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.log({
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.login.deactivated',
        module: 'auth',
        outcome: 'failure',
      });
      throw new UnauthorizedException('Account is deactivated');
    }

    // 5. Issue tokens
    const tokens = await this.issueTokens(user.id, tenant.id, user.tokenVersion, dto.deviceInfo);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.log({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: 'auth.login.success',
      module: 'auth',
      outcome: 'success',
      metadata: { ip: dto.ip },
    });

    return tokens;
  }

  /**
   * Refresh token rotation — old token is revoked, new pair issued.
   * Reuse detection: if old token is already revoked, revoke the entire family.
   * SRS V2 NFR-004 / SECURITY §3.
   */
  async refresh(rawRefreshToken: string, deviceInfo?: string): Promise<AuthTokens> {
    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    // Reuse detection — if already revoked, revoke ALL tokens for this user (compromise)
    if (stored.isRevoked) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      });
      await this.audit.log({
        tenantId: stored.tenantId,
        actorUserId: stored.userId,
        action: 'auth.refresh.reuse_detected',
        module: 'auth',
        outcome: 'failure',
      });
      throw new UnauthorizedException('Token reuse detected — all sessions revoked');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke old token
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    // Verify user is still active
    const user = await this.users.findById(stored.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is deactivated');
    }

    return this.issueTokens(stored.userId, stored.tenantId, user.tokenVersion, deviceInfo);
  }

  /** Logout — revokes the provided refresh token */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /** Logout all sessions for a user (e.g. on password change) */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    await this.users.incrementTokenVersion(userId);
  }

  /**
   * Initiate password reset — generates single-use, time-limited token.
   * SRS V2 FR-115 / SECURITY §3.
   */
  async initiatePasswordReset(tenantId: string, login: string): Promise<string> {
    const isEmail = login.includes('@');
    const user = isEmail
      ? await this.users.findByEmail(tenantId, login)
      : await this.users.findByPhone(tenantId, login);

    // Always return success to prevent user enumeration
    if (!user) return 'ok';

    const rawToken = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing reset tokens for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tenantId, tokenHash, expiresAt },
    });

    await this.audit.log({
      tenantId,
      actorUserId: user.id,
      action: 'auth.password_reset.initiated',
      module: 'auth',
      outcome: 'success',
    });

    // In production: send rawToken via email/SMS (notification service Phase 3)
    // For now return it so tests can verify the flow
    return rawToken;
  }

  /** Complete password reset — verifies token, updates hash, revokes all sessions */
  async completePasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const { hashPassword: hash } = await import('../../common/utils/password.util');
    const newHash = await hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
      }),
    ]);

    await this.logoutAll(record.userId);
  }

  /** Validate a JWT access token — used by JwtStrategy */
  async validateAccessToken(payload: JwtPayload): Promise<{ userId: string; tenantId: string } | null> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.tenantId !== payload.tid) return null;
    if (user.status !== UserStatus.ACTIVE) return null;
    // tokenVersion mismatch means the user was deactivated or password changed
    if (user.tokenVersion !== payload.tv) return null;
    return { userId: payload.sub, tenantId: payload.tid };
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    tokenVersion: number,
    deviceInfo?: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, tid: tenantId, tv: tokenVersion };
    const accessExpiry = this.config.get<string>('app.jwtAccessExpiry', '15m');
    const accessToken = this.jwt.sign(payload, { expiresIn: accessExpiry });

    const rawRefresh = generateToken(32);
    const refreshHash = hashToken(rawRefresh);
    const refreshExpiry = this.config.get<string>('app.jwtRefreshExpiry', '7d');
    const expiresAt = new Date(
      Date.now() + this.parseDuration(refreshExpiry),
    );

    await this.prisma.refreshToken.create({
      data: { userId, tenantId, tokenHash: refreshHash, expiresAt, deviceInfo },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: this.parseDuration(accessExpiry) / 1000,
    };
  }

  private parseDuration(d: string): number {
    const n = parseInt(d);
    if (d.endsWith('m')) return n * 60 * 1000;
    if (d.endsWith('h')) return n * 60 * 60 * 1000;
    if (d.endsWith('d')) return n * 24 * 60 * 60 * 1000;
    return n * 1000;
  }
}
