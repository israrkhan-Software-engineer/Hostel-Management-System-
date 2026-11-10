import {
  Injectable,
  Optional,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
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
  hashPassword,
  needsPasswordRehash,
} from '../../common/utils/password.util';
import { decryptField, encryptField } from '../../common/utils/field-encryption.util';
import {
  authenticatorUri,
  generateRecoveryCodes,
  generateTotpSecret,
  recoveryCodeHash,
  verifyTotp,
} from '../platform-admin/platform-mfa.util';
import { RefreshTokenReuseException } from '../../common/exceptions/refresh-token-reuse.exception';
import { UserStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

const DUMMY_PASSWORD_HASH = hashPassword('HMS invalid-account timing equalization');

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private tenants: TenantsService,
    private users: UsersService,
    private audit: AuditService,
    @Optional() private notifications?: NotificationsService,
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
    mfaCode?: string;
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
    const dummyHash = await DUMMY_PASSWORD_HASH;
    const valid = user
      ? await verifyPassword(dto.password, user.passwordHash)
      : await verifyPassword(dto.password, dummyHash);

    const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
    if (!user || !valid || locked) {
      await this.recordLoginFailure(
        tenant.id,
        user?.id,
        { login: dto.login, ip: dto.ip ?? null, reason: locked ? 'locked' : 'credentials' },
        !locked,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Check user is ACTIVE — deactivated users are denied immediately (SRS V2 FR-116)
    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.logDurably({
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.login.deactivated',
        module: 'auth',
        outcome: 'failure',
      });
      throw new UnauthorizedException('Account is deactivated');
    }

    if (user.mfaEnabled) {
      const mfaCode = dto.mfaCode;
      const totpValid = Boolean(
        mfaCode && user.mfaSecretEncrypted
        && verifyTotp(decryptField(user.mfaSecretEncrypted, this.fieldEncryptionKey()), mfaCode),
      );
      const recoveryValid = !totpValid && mfaCode
        ? (await this.prisma.userMfaRecoveryCode.updateMany({
          where: {
            tenantId: tenant.id,
            userId: user.id,
            codeHash: recoveryCodeHash(mfaCode),
            usedAt: null,
          },
          data: { usedAt: new Date() },
        })).count === 1
        : false;
      if (!totpValid && !recoveryValid) {
        await this.recordLoginFailure(
          tenant.id,
          user.id,
          { login: dto.login, ip: dto.ip ?? null, reason: 'mfa' },
          true,
        );
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    // 5. Issue tokens
    const tokens = await this.issueTokens(user.id, tenant.id, user.tokenVersion, dto.deviceInfo);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(needsPasswordRehash(user.passwordHash)
          ? { passwordHash: await hashPassword(dto.password) }
          : {}),
      },
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

    if (stored.isRevoked) {
      throw new RefreshTokenReuseException(stored.tenantId, stored.userId);
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Verify user is still active
    const user = await this.users.findById(stored.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: {
        id: stored.id,
        tenantId: stored.tenantId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new RefreshTokenReuseException(stored.tenantId, stored.userId);
    }

    return this.issueTokens(stored.userId, stored.tenantId, user.tokenVersion, deviceInfo);
  }

  async beginTenantMfaEnrollment(userId: string, tenantId: string, password: string) {
    if (!this.tenantMfaEnabled()) throw new ForbiddenException('Tenant MFA enrollment is disabled');
    const user = await this.users.findById(userId);
    if (
      !user
      || user.tenantId !== tenantId
      || user.status !== UserStatus.ACTIVE
      || !await verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');

    const secret = user.mfaEnrollmentSecretEncrypted
      ? decryptField(user.mfaEnrollmentSecretEncrypted, this.fieldEncryptionKey())
      : generateTotpSecret();
    if (!user.mfaEnrollmentSecretEncrypted) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnrollmentSecretEncrypted: encryptField(secret, this.fieldEncryptionKey()) },
      });
    }

    return {
      authenticatorUri: authenticatorUri(secret, user.email ?? user.phone ?? user.id, 'HMS Hostel'),
    };
  }

  async completeTenantMfaEnrollment(userId: string, tenantId: string, code: string) {
    if (!this.tenantMfaEnabled()) throw new ForbiddenException('Tenant MFA enrollment is disabled');
    const user = await this.users.findById(userId);
    if (
      !user
      || user.tenantId !== tenantId
      || user.status !== UserStatus.ACTIVE
      || user.mfaEnabled
      || !user.mfaEnrollmentSecretEncrypted
    ) {
      throw new BadRequestException('MFA enrollment is not active');
    }

    const secret = decryptField(user.mfaEnrollmentSecretEncrypted, this.fieldEncryptionKey());
    if (!verifyTotp(secret, code)) throw new UnauthorizedException('Invalid authenticator code');

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecretEncrypted: user.mfaEnrollmentSecretEncrypted,
          mfaEnrollmentSecretEncrypted: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, tenantId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
      this.prisma.userMfaRecoveryCode.createMany({
        data: recoveryCodes.map((codeValue) => ({
          userId,
          tenantId,
          codeHash: recoveryCodeHash(codeValue),
        })),
      }),
    ]);

    await this.audit.log({
      tenantId,
      actorUserId: userId,
      action: 'auth.mfa.enrolled',
      module: 'auth',
      outcome: 'success',
    });
    return { recoveryCodes };
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

  async changePassword(
    userId: string,
    tenantId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (
      !user
      || user.tenantId !== tenantId
      || user.status !== UserStatus.ACTIVE
      || !await verifyPassword(currentPassword, user.passwordHash)
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    const changed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.user.updateMany({
        where: {
          id: userId,
          tenantId,
          passwordHash: user.passwordHash,
          status: UserStatus.ACTIVE,
        },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      if (update.count !== 1) return false;
      await tx.refreshToken.updateMany({
        where: { userId, tenantId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId, tenantId, usedAt: null },
        data: { usedAt: now },
      });
      return true;
    });
    if (!changed) throw new UnauthorizedException('Account changed; authenticate and try again');
    await this.audit.log({
      tenantId,
      actorUserId: userId,
      action: 'auth.password.changed',
      module: 'auth',
      outcome: 'success',
    });
  }

  /**
   * Initiate password reset — generates single-use, time-limited token.
   * SRS V2 FR-115 / SECURITY §3.
   */
  async initiatePasswordReset(tenantId: string, login: string): Promise<void> {
    const isEmail = login.includes('@');
    const user = isEmail
      ? await this.users.findByEmail(tenantId, login)
      : await this.users.findByPhone(tenantId, login);

    // Always return success to prevent user enumeration
    if (!user) return;

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

    if (user.email) {
      const resetUrl = new URL('/reset-password', this.config.get<string>('app.frontendUrl'));
      resetUrl.searchParams.set('token', rawToken);
      const resetLink = resetUrl.toString();
      try {
        await this.notifications?.enqueueDelivery({
          kind: 'email',
          to: user.email,
          subject: 'Reset your Hostel Management System password',
          text: `Use this single-use link within 1 hour to reset your password: ${resetLink}`,
          html: `<p>Use this single-use link within 1 hour to reset your password:</p><p><a href="${resetLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">Reset password</a></p>`,
        }, `password-reset:${user.id}:${tokenHash}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(`Password-reset delivery enqueue failed for user ${user.id}: ${detail}`);
        await this.audit.log({
          tenantId,
          actorUserId: user.id,
          action: 'auth.password_reset.delivery_failed',
          module: 'auth',
          outcome: 'failure',
        });
      }
    }
  }

  async initiatePasswordResetBySlug(tenantSlug: string, login: string): Promise<void> {
    const tenantId = await this.prisma.resolvePublicTenantSlug(tenantSlug);
    if (tenantId) await this.initiatePasswordReset(tenantId, login);
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
        data: {
          passwordHash: newHash,
          tokenVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
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
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.parseDuration(accessExpiry) / 1000,
    });

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

  private async recordLoginFailure(
    tenantId: string,
    userId: string | undefined,
    metadata: { login: string; ip: string | null; reason: string },
    incrementAttempts: boolean,
  ): Promise<void> {
    await this.prisma.runWithIndependentTenantContext(tenantId, async () => {
      if (userId && incrementAttempts) {
        const maxAttempts = Number(this.config.get('app.loginMaxAttempts', 5));
        const lockoutMinutes = Number(this.config.get('app.loginLockoutMinutes', 15));
        await this.prisma.$executeRaw`
          UPDATE users
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE
                WHEN failed_login_attempts + 1 >= ${maxAttempts}
                  THEN NOW() + make_interval(mins => ${lockoutMinutes})
                ELSE locked_until
              END,
              updated_at = NOW()
          WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
          RETURNING failed_login_attempts
        `;
      }
      await this.audit.logOrThrow({
        tenantId,
        actorUserId: userId,
        action: 'auth.login.failed',
        module: 'auth',
        outcome: 'failure',
        metadata,
      });
    });
  }

  private tenantMfaEnabled(): boolean {
    return this.config.get<boolean>('app.tenantMfaEnabled', true);
  }

  private fieldEncryptionKey(): string {
    return this.config.getOrThrow<string>('app.fieldEncryptionKey');
  }

  private parseDuration(d: string): number {
    const n = parseInt(d);
    if (d.endsWith('m')) return n * 60 * 1000;
    if (d.endsWith('h')) return n * 60 * 60 * 1000;
    if (d.endsWith('d')) return n * 24 * 60 * 60 * 1000;
    return n * 1000;
  }
}
