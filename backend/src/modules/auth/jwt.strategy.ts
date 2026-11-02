import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * JWT strategy — validates every protected request.
 * tokenVersion check ensures deactivated users lose access immediately
 * without waiting for JWT expiry. (SRS V2 FR-116, SECURITY §3)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private authService: AuthService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('app.jwtSecret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<{ userId: string; tenantId: string }> {
    const result = await this.prisma.runWithTenantContext(
      payload.tid,
      () => this.authService.validateAccessToken(payload),
    );
    if (!result) {
      throw new UnauthorizedException('Token is invalid or account is deactivated');
    }
    return result;
  }
}
