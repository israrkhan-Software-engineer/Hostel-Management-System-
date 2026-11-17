import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UsersService } from '../users/users.service';
import { BusinessPoliciesService } from './business-policies.service';
import {
  PolicyApprovalActionDto,
  UpdateBackupSchedulePolicyDto,
  UpdateDataRetentionPolicyDto,
  UpdatePhysicalDeletePolicyDto,
  UpdateVisitorHoursPolicyDto,
} from './business-policies.dto';
import { PolicyDomain } from './business-policies.types';

@ApiTags('business-policies')
@ApiBearerAuth()
@Controller({ path: 'business-policies', version: '1' })
export class BusinessPoliciesController {
  constructor(
    private readonly policiesService: BusinessPoliciesService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequirePermission('tenants', 'view')
  async getTenantPolicies(@CurrentUser() user: RequestUser) {
    return this.policiesService.getTenantPolicies(user.tenantId);
  }

  @Get('branches/:branchId')
  @RequirePermission('tenants', 'view')
  async getBranchPolicies(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.policiesService.getBranchPolicies(user.tenantId, branchId);
  }

  @Put('retention')
  @RequirePermission('tenants', 'manage_settings')
  async updateRetentionPolicy(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateDataRetentionPolicyDto,
  ) {
    return this.policiesService.updateRetentionPolicy(user.tenantId, user.userId, dto);
  }

  @Put('backup-schedule')
  @RequirePermission('tenants', 'manage_settings')
  async updateBackupSchedulePolicy(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateBackupSchedulePolicyDto,
  ) {
    return this.policiesService.updateBackupSchedulePolicy(user.tenantId, user.userId, dto);
  }

  @Put('visitor-hours')
  @RequirePermission('tenants', 'manage_settings')
  async updateTenantVisitorHoursPolicy(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateVisitorHoursPolicyDto,
  ) {
    return this.policiesService.updateVisitorHoursPolicy(user.tenantId, null, user.userId, dto);
  }

  @Put('branches/:branchId/visitor-hours')
  @RequirePermission('tenants', 'manage_settings')
  async updateBranchVisitorHoursPolicy(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateVisitorHoursPolicyDto,
  ) {
    return this.policiesService.updateVisitorHoursPolicy(user.tenantId, branchId, user.userId, dto);
  }

  @Put('physical-delete')
  @RequirePermission('tenants', 'manage_settings')
  async updatePhysicalDeletePolicy(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdatePhysicalDeletePolicyDto,
  ) {
    return this.policiesService.updatePhysicalDeletePolicy(user.tenantId, user.userId, dto);
  }

  @Post(':domain/approval')
  @RequirePermission('tenants', 'manage_settings')
  async handleApprovalAction(
    @Param('domain') domain: PolicyDomain,
    @CurrentUser() user: RequestUser,
    @Body() dto: PolicyApprovalActionDto,
  ) {
    // Check if user holds 'Owner' or 'System Admin' role
    const userWithRoles = await this.usersService.findByIdWithRoles(user.userId);
    const roleNames = userWithRoles?.userRoles.map((ur) => ur.role.name) ?? [];
    const isOwner = roleNames.includes('Owner') || roleNames.includes('System Admin');

    return this.policiesService.handleApprovalAction(
      user.tenantId,
      domain,
      user.userId,
      dto,
      isOwner,
    );
  }
}
