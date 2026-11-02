import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PlatformAuthService } from './platform-auth.service';

interface PlatformToken {
  sub: string;
  scope: 'platform-admin';
  tv: number;
}

interface PlatformRequest extends Request {
  platformAdminId?: string;
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly jwtSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly auth: PlatformAuthService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.getOrThrow<string>('app.platformJwtSecret');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const token = request.headers.authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Platform administrator sign-in is required');

    let payload: PlatformToken;
    try {
      payload = await this.jwt.verifyAsync<PlatformToken>(token, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('Platform session is invalid or expired');
    }
    if (payload.scope !== 'platform-admin' || !payload.sub || !Number.isInteger(payload.tv)) {
      throw new UnauthorizedException('Platform session is invalid');
    }
    if (!await this.auth.validateToken(payload.sub, payload.tv)) {
      throw new UnauthorizedException('Platform administrator is inactive');
    }
    request.platformAdminId = payload.sub;
    return true;
  }
}