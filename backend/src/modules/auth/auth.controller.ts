import {
  Controller, Get, Post, Body, Res, Req, HttpCode, HttpStatus, UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, LogoutDto, InitiateResetDto, CompleteResetDto } from './auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';

const REFRESH_COOKIE = 'hms_refresh';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
};

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async profile(@CurrentUser() currentUser: RequestUser) {
    const user = await this.users.findByIdWithRoles(currentUser.userId);
    if (!user || user.tenantId !== currentUser.tenantId) {
      throw new UnauthorizedException('Session user was not found');
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      roles: user.userRoles.map(({ role }) => role.name),
      permissions: [
        ...new Set(
          user.userRoles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => `${permission.module}:${permission.action}`),
          ),
        ),
      ],
    };
  }

  /**
   * POST /api/v1/auth/login
   * Rate-limited: 5 attempts per minute per IP (SRS V2 SECURITY §3, NFR-004)
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const ip = req.ip;
    const tokens = await this.auth.login({ ...dto, ip });
    // Refresh token in HttpOnly cookie — access token in response body
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  /**
   * POST /api/v1/auth/refresh
   * Reads refresh token from HttpOnly cookie (preferred) or body fallback.
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? dto.refreshToken;
    if (!rawToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token' });
    }
    const tokens = await this.auth.refresh(rawToken);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  /** POST /api/v1/auth/logout — revokes the current refresh token */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? dto.refreshToken;
    if (rawToken) await this.auth.logout(rawToken);
    res.clearCookie(REFRESH_COOKIE, { ...COOKIE_OPTS });
  }

  /** POST /api/v1/auth/logout-all — revokes ALL sessions for the authenticated user */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logoutAll(@Req() req: Request & { user: { userId: string } }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(req.user.userId);
    res.clearCookie(REFRESH_COOKIE, { ...COOKIE_OPTS });
  }

  /** POST /api/v1/auth/reset-password — initiate reset (time-limited single-use token) */
  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async initiateReset(@Body() dto: InitiateResetDto) {
    const tenant = await this.auth['tenants'].findBySlug(dto.tenantSlug);
    await this.auth.initiatePasswordReset(tenant.id, dto.login);
    // Always return same response to prevent user enumeration
    return { message: 'If an account exists, a reset link has been sent' };
  }

  /** POST /api/v1/auth/reset-password/complete */
  @Post('reset-password/complete')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async completeReset(@Body() dto: CompleteResetDto) {
    await this.auth.completePasswordReset(dto.token, dto.newPassword);
  }
}
