import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAuthService } from './platform-auth.service';

describe('PlatformAdminGuard', () => {
  let guard: PlatformAdminGuard;
  let jwt: { verifyAsync: jest.Mock };
  let auth: { validateToken: jest.Mock };
  let request: { headers: { authorization?: string }; platformAdminId?: string };

  const context = () => ({
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext);

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    auth = { validateToken: jest.fn().mockResolvedValue(true) };
    request = { headers: {} };
    const config = { getOrThrow: jest.fn().mockReturnValue('platform-secret') };
    guard = new PlatformAdminGuard(
      jwt as unknown as JwtService,
      auth as unknown as PlatformAuthService,
      config as unknown as ConfigService,
    );
  });

  it('rejects requests without a platform bearer token', async () => {
    await expect(guard.canActivate(context())).rejects.toThrow(UnauthorizedException);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects tenant-scoped tokens without validating their user', async () => {
    request.headers.authorization = 'Bearer tenant-token';
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-id', scope: 'tenant', tv: 0 });

    await expect(guard.canActivate(context())).rejects.toThrow(UnauthorizedException);
    expect(auth.validateToken).not.toHaveBeenCalled();
  });

  it('rejects inactive or revoked platform administrators', async () => {
    request.headers.authorization = 'Bearer platform-token';
    jwt.verifyAsync.mockResolvedValue({ sub: 'admin-id', scope: 'platform-admin', tv: 3 });
    auth.validateToken.mockResolvedValue(false);

    await expect(guard.canActivate(context())).rejects.toThrow(UnauthorizedException);
    expect(auth.validateToken).toHaveBeenCalledWith('admin-id', 3);
  });

  it('sets administrator identity only for a valid platform token', async () => {
    request.headers.authorization = 'Bearer platform-token';
    jwt.verifyAsync.mockResolvedValue({ sub: 'admin-id', scope: 'platform-admin', tv: 3 });

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.platformAdminId).toBe('admin-id');
  });
});
