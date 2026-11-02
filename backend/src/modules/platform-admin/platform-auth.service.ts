import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decryptField, encryptField } from '../../common/utils/field-encryption.util';
import { verifyPassword } from '../../common/utils/password.util';
import { PlatformLoginDto, PlatformMfaEnrollmentDto } from './platform-auth.dto';
import {
  authenticatorUri,
  generateRecoveryCodes,
  generateTotpSecret,
  recoveryCodeHash,
  verifyTotp,
} from './platform-mfa.util';

const DUMMY_PASSWORD_HASH = 'pbkdf2:100000:00000000000000000000000000000000:' + '0'.repeat(128);

@Injectable()
export class PlatformAuthService {
  private readonly jwtSecret: string;
  private readonly fieldEncryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.getOrThrow<string>('app.platformJwtSecret');
    this.fieldEncryptionKey = config.getOrThrow<string>('app.fieldEncryptionKey');
  }

  async login(dto: PlatformLoginDto) {
    const email = dto.email.trim().toLowerCase();
    return this.prisma.runWithPlatformLoginContext(email, async () => {
      const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
      const passwordValid = await verifyPassword(dto.password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!admin || admin.status !== 'ACTIVE' || !passwordValid) {
        throw new UnauthorizedException('Invalid platform credentials');
      }

      if (!admin.mfaSecretEncrypted) {
        const secret = admin.mfaEnrollmentSecretEncrypted
          ? decryptField(admin.mfaEnrollmentSecretEncrypted, this.fieldEncryptionKey)
          : generateTotpSecret();
        if (!admin.mfaEnrollmentSecretEncrypted) {
          await this.prisma.runWithPlatformContext(admin.id, async () => {
            await this.prisma.platformAdmin.update({
              where: { id: admin.id },
              data: { mfaEnrollmentSecretEncrypted: encryptField(secret, this.fieldEncryptionKey) },
            });
          });
        }
        const enrollmentToken = await this.jwt.signAsync(
          { sub: admin.id, scope: 'platform-admin-mfa-enrollment', tv: admin.tokenVersion },
          { secret: this.jwtSecret, expiresIn: '10m' },
        );
        return {
          mfaEnrollmentRequired: true as const,
          enrollmentToken,
          authenticatorUri: authenticatorUri(secret, admin.email),
        };
      }

      const secret = decryptField(admin.mfaSecretEncrypted, this.fieldEncryptionKey);
      const mfaCode = dto.mfaCode;
      const totpValid = mfaCode ? verifyTotp(secret, mfaCode) : false;
      const recoveryValid = totpValid
        ? false
        : mfaCode
          ? await this.prisma.runWithPlatformContext(admin.id, async () => {
            const result = await this.prisma.platformAdminRecoveryCode.updateMany({
              where: {
                platformAdminId: admin.id,
                codeHash: recoveryCodeHash(mfaCode),
                usedAt: null,
              },
              data: { usedAt: new Date() },
            });
            return result.count === 1;
          })
          : false;
      if (!totpValid && !recoveryValid) {
        throw new UnauthorizedException('Invalid platform credentials');
      }

      await this.prisma.runWithPlatformContext(admin.id, async () => {
        await this.prisma.platformAdmin.update({
          where: { id: admin.id },
          data: { lastLoginAt: new Date() },
        });
        await this.prisma.platformAdminAuditLog.create({
          data: { platformAdminId: admin.id, action: 'platform.auth.login', metadata: {} },
        });
      });

      return this.createAccessToken(admin.id, admin.tokenVersion);
    });
  }

  async completeMfaEnrollment(dto: PlatformMfaEnrollmentDto) {
    let payload: { sub?: string; scope?: string; tv?: number };
    try {
      payload = await this.jwt.verifyAsync(dto.enrollmentToken, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA enrollment session');
    }
    if (
      payload.scope !== 'platform-admin-mfa-enrollment'
      || typeof payload.sub !== 'string'
      || !Number.isInteger(payload.tv)
    ) {
      throw new UnauthorizedException('Invalid or expired MFA enrollment session');
    }
    const adminId = payload.sub;
    const tokenVersion = payload.tv;

    return this.prisma.runWithPlatformContext(adminId, async () => {
      const admin = await this.prisma.platformAdmin.findUnique({
        where: { id: adminId },
        select: {
          email: true,
          status: true,
          tokenVersion: true,
          mfaSecretEncrypted: true,
          mfaEnrollmentSecretEncrypted: true,
        },
      });
      if (
        !admin
        || admin.status !== 'ACTIVE'
        || admin.tokenVersion !== tokenVersion
        || admin.mfaSecretEncrypted
        || !admin.mfaEnrollmentSecretEncrypted
      ) {
        throw new UnauthorizedException('Invalid or expired MFA enrollment session');
      }

      const secret = decryptField(admin.mfaEnrollmentSecretEncrypted, this.fieldEncryptionKey);
      if (!verifyTotp(secret, dto.code)) {
        throw new UnauthorizedException('Invalid authenticator code');
      }

      const recoveryCodes = generateRecoveryCodes();
      await this.prisma.platformAdmin.update({
        where: { id: adminId },
        data: {
          mfaSecretEncrypted: admin.mfaEnrollmentSecretEncrypted,
          mfaEnrollmentSecretEncrypted: null,
          recoveryCodes: {
            create: recoveryCodes.map((code) => ({ codeHash: recoveryCodeHash(code) })),
          },
        },
      });
      await this.prisma.platformAdminAuditLog.create({
        data: { platformAdminId: adminId, action: 'platform.auth.mfa_enroll', metadata: {} },
      });

      return {
        recoveryCodes,
        ...(await this.createAccessToken(adminId, tokenVersion)),
      };
    });
  }

  private async createAccessToken(adminId: string, tokenVersion: number) {
    const accessToken = await this.jwt.signAsync(
      { sub: adminId, scope: 'platform-admin', tv: tokenVersion },
      { secret: this.jwtSecret, expiresIn: '5m' },
    );
    return { accessToken, expiresIn: 300 };
  }

  async validateToken(adminId: string, tokenVersion: number): Promise<boolean> {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const admin = await this.prisma.platformAdmin.findUnique({
        where: { id: adminId },
        select: { status: true, tokenVersion: true },
      });
      return admin?.status === 'ACTIVE' && admin.tokenVersion === tokenVersion;
    });
  }
}