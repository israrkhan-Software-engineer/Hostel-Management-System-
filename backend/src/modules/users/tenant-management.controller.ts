import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateTenantUserDto, ResetTenantUserPasswordDto, SaveTenantRoleDto, TenantManagementQueryDto, UpdateTenantUserProfileDto } from './tenant-management.dto';
import { TenantManagementService } from './tenant-management.service';

@ApiTags('tenant-user-management')
@ApiBearerAuth()
@Controller({ path: 'tenant-management', version: '1' })
export class TenantManagementController {
  constructor(private readonly management: TenantManagementService) {}

  @Get('users')
  @RequirePermission('users', 'view')
  listUsers(@CurrentUser() user: RequestUser, @Query() query: TenantManagementQueryDto) {
    return this.management.listUsers(user, query.page, query.pageSize);
  }

  @Get('subscription')
  @RequirePermission('users', 'view')
  subscription(@CurrentUser() user: RequestUser) {
    return this.management.subscriptionSummary(user.tenantId);
  }

  @Post('users')
  @RequirePermission('users', 'create')
  createUser(@CurrentUser() user: RequestUser, @Body() dto: CreateTenantUserDto) {
    return this.management.createUser(user, dto);
  }

  @Patch('users/:userId')
  @RequirePermission('users', 'edit')
  updateUser(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateTenantUserProfileDto,
  ) {
    return this.management.updateUser(user, userId, dto);
  }

  @Post('users/:userId/password')
  @RequirePermission('users', 'edit')
  resetUserPassword(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ResetTenantUserPasswordDto,
  ) {
    return this.management.resetUserPassword(user, userId, dto);
  }

  @Get('roles')
  @RequirePermission('roles', 'view')
  listRoles(@CurrentUser() user: RequestUser) {
    return this.management.listRoles(user.tenantId);
  }

  @Post('roles')
  @RequirePermission('roles', 'create')
  createRole(@CurrentUser() user: RequestUser, @Body() dto: SaveTenantRoleDto) {
    return this.management.createRole(user, dto);
  }

  @Patch('roles/:roleId')
  @RequirePermission('roles', 'edit')
  updateRole(
    @CurrentUser() user: RequestUser,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SaveTenantRoleDto,
  ) {
    return this.management.updateRole(user, roleId, dto);
  }

  @Delete('roles/:roleId')
  @RequirePermission('roles', 'delete')
  deleteRole(
    @CurrentUser() user: RequestUser,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.management.deleteRole(user, roleId);
  }
}
