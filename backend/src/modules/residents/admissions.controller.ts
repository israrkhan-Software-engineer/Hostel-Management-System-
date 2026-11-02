import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  AdmissionDecisionDto,
  AdmissionFilterDto,
  AllocateBedDto,
  CreateAdmissionDto,
  UpdateAdmissionDto,
} from './residents.dto';
import { AdmissionsService } from './admissions.service';

@ApiTags('admissions')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId/admissions', version: '1' })
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermission('admissions', 'view')
  list(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: AdmissionFilterDto,
  ) {
    return this.admissions.list(user.tenantId, branchId, filter.status);
  }

  @Get('available-beds')
  @RequirePermission('allocations', 'view')
  availableBeds(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.admissions.availableBeds(user.tenantId, branchId);
  }

  @Post()
  @RequirePermission('admissions', 'create')
  create(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAdmissionDto,
  ) {
    return this.admissions.create(user.tenantId, branchId, user.userId, dto);
  }

  @Patch(':admissionId')
  @RequirePermission('admissions', 'edit')
  update(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateAdmissionDto,
  ) {
    return this.admissions.update(
      user.tenantId,
      branchId,
      user.userId,
      admissionId,
      dto,
    );
  }

  @Post(':admissionId/cancel')
  @RequirePermission('admissions', 'edit')
  cancel(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.admissions.cancel(user.tenantId, branchId, user.userId, admissionId);
  }

  @Patch(':admissionId/decision')
  @RequirePermission('admissions', 'approve')
  decide(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AdmissionDecisionDto,
  ) {
    return this.admissions.decide(user.tenantId, branchId, user.userId, admissionId, dto);
  }

  @Post(':admissionId/allocation')
  @RequirePermission('allocations', 'assign')
  allocateBed(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AllocateBedDto,
  ) {
    return this.admissions.allocateBed(
      user.tenantId,
      branchId,
      user.userId,
      admissionId,
      dto.bedId,
    );
  }

  @Post(':admissionId/check-in')
  @RequirePermission('allocations', 'assign')
  checkIn(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.admissions.checkIn(user.tenantId, branchId, user.userId, admissionId);
  }

  @Post(':admissionId/check-out')
  @RequirePermission('allocations', 'assign')
  checkOut(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.admissions.checkOut(user.tenantId, branchId, user.userId, admissionId);
  }

  @Get(':admissionId')
  @RequirePermission('admissions', 'view')
  get(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.admissions.get(user.tenantId, branchId, admissionId);
  }
}
