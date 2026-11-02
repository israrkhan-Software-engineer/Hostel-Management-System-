import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { encryptField } from '../../common/utils/field-encryption.util';
import { hashPassword } from '../../common/utils/password.util';
import { PlatformAuthService } from './platform-auth.service';

describe('PlatformAuthService', () => {
  const email = 'admin@example.test';
  const password = 'Platform-admin-password-2026';
  let service: PlatformAuthService;
  let passwordHash: string;
  let prisma: {
    runWithPlatformLoginContext: jest.Mock;
    runWithPlatformContext: jest.Mock;
    platformAdmin: { findUnique: jest.Mock; update: jest.Mock };
    platformAdminAuditLog: { create: jest.Mock };
  };
  let jwt: { signAsync: jest.Mock };

  beforeAll(async () => {
    passwordHash = await hashPassword(password);
  });

  beforeEach(() => {
    prisma = {
      runWithPlatformLoginContext: jest.fn((_email, operation) => operation()),
      runWithPlatformContext: jest.fn((_adminId, operation) => operation()),
      platformAdmin: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      platformAdminAuditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('platform-access-token') };
    service = new PlatformAuthService(
      prisma as never,
      jwt as never as JwtService,
      new ConfigService({
        app: {
          platformJwtSecret: 'test-platform-jwt-secret',
          fieldEncryptionKey: 'test-field-encryption-key',
        },
      }),
    );
  });

  it('starts MFA enrollment after password verification for an account without MFA', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'admin-id',
      email,
      passwordHash,
      status: 'ACTIVE',
      tokenVersion: 0,
      mfaSecretEncrypted: null,
      mfaEnrollmentSecretEncrypted: null,
    });

    const response = await service.login({ email: ` ${email.toUpperCase()} `, password });

    expect(response).toEqual({
      mfaEnrollmentRequired: true,
      enrollmentToken: 'platform-access-token',
      authenticatorUri: expect.stringMatching(/^otpauth:\/\/totp\//),
    });
    expect(prisma.platformAdmin.update).toHaveBeenCalledWith({
      where: { id: 'admin-id' },
      data: { mfaEnrollmentSecretEncrypted: expect.any(String) },
    });
    expect(prisma.platformAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('requires an authenticator or recovery code for an enrolled account', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'admin-id',
      email,
      passwordHash,
      status: 'ACTIVE',
      tokenVersion: 0,
      mfaSecretEncrypted: encryptField('JBSWY3DPEHPK3PXP', 'test-field-encryption-key'),
      mfaEnrollmentSecretEncrypted: null,
    });

    await expect(service.login({ email, password })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.platformAdmin.update).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
