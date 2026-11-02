import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuthService } from './platform-auth.service';
import {
  CreateTenantDto,
  PlatformLoginBodyDto,
  PlatformPaginationDto,
  ResetTenantOwnerPasswordDto,
  TenantQueryDto,
  TenantUserQueryDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
  UpdateTenantUserDto,
} from './platform-admin.dto';
import { PlatformMfaEnrollmentDto } from './platform-auth.dto';

interface PlatformRequest extends Request {
  platformAdminId?: string;
}

@ApiTags('platform-admin')
@Public()
@Controller({ path: 'platform/admin', version: '1' })
export class PlatformAdminController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly platform: PlatformAdminService,
  ) {}

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  login(@Body() dto: PlatformLoginBodyDto) {
    return this.auth.login(dto);
  }

  @Post('auth/enroll-mfa')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  enrollMfa(@Body() dto: PlatformMfaEnrollmentDto) {
    return this.auth.completeMfaEnrollment(dto);
  }

  @Get('dashboard')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  dashboard(@Req() request: PlatformRequest) {
    return this.platform.dashboard(this.adminId(request));
  }

  @Get('tenants')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  listTenants(@Req() request: PlatformRequest, @Query() filter: TenantQueryDto) {
    return this.platform.listTenants(this.adminId(request), filter);
  }

  @Post('tenants')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  createTenant(@Req() request: PlatformRequest, @Body() dto: CreateTenantDto) {
    return this.platform.createTenant(this.adminId(request), dto);
  }

  @Get('tenants/:tenantId')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  getTenant(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.platform.getTenant(this.adminId(request), tenantId);
  }

  @Patch('tenants/:tenantId')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  updateTenant(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.platform.updateTenant(this.adminId(request), tenantId, dto);
  }

  @Post('tenants/:tenantId/owner/password')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  resetTenantOwnerPassword(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: ResetTenantOwnerPasswordDto,
  ) {
    return this.platform.resetTenantOwnerPassword(this.adminId(request), tenantId, dto);
  }

  @Patch('tenants/:tenantId/status')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  updateTenantStatus(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.platform.updateTenantStatus(this.adminId(request), tenantId, dto);
  }

  @Get('tenants/:tenantId/users')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  listTenantUsers(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() filter: TenantUserQueryDto,
  ) {
    return this.platform.listTenantUsers(this.adminId(request), tenantId, filter);
  }

  @Get('tenants/:tenantId/roles')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  listTenantRoles(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.platform.listTenantRoles(this.adminId(request), tenantId);
  }

  @Patch('tenants/:tenantId/users/:userId')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  updateTenantUser(
    @Req() request: PlatformRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateTenantUserDto,
  ) {
    return this.platform.updateTenantUser(this.adminId(request), tenantId, userId, dto);
  }

  @Get('audit')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  listAudit(@Req() request: PlatformRequest, @Query() filter: PlatformPaginationDto) {
    return this.platform.listAuditLogs(this.adminId(request), filter);
  }

  private adminId(request: PlatformRequest): string {
    if (!request.platformAdminId) throw new Error('Platform guard must set administrator identity');
    return request.platformAdminId;
  }
}