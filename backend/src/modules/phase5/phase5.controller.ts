import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateVisitorVisitDto } from './phase5.dto';
import { Phase5Service } from './phase5.service';

@ApiTags('gate operations')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId', version: '1' })
export class Phase5Controller {
  constructor(private readonly phase5: Phase5Service) {}

  @Get('visitors')
  @RequirePermission('visitors', 'view')
  listVisitorVisits(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query('q') search?: string,
  ) {
    return this.phase5.listVisitorVisits(user.tenantId, branchId, search);
  }

  @Post('visitors')
  @RequirePermission('visitors', 'create')
  createVisitorVisit(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVisitorVisitDto,
  ) {
    return this.phase5.createVisitorVisit(user.tenantId, branchId, user.userId, dto);
  }

  @Post('visitors/:visitId/approve')
  @RequirePermission('visitors', 'approve')
  approveVisitorVisit(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase5.approveVisitorVisit(user.tenantId, branchId, user.userId, visitId);
  }

  @Post('visitors/:visitId/reject')
  @RequirePermission('visitors', 'approve')
  rejectVisitorVisit(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase5.rejectVisitorVisit(user.tenantId, branchId, user.userId, visitId);
  }

  @Post('visitors/:visitId/check-in')
  @RequirePermission('visitors', 'edit')
  checkInVisitor(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase5.checkInVisitor(user.tenantId, branchId, user.userId, visitId);
  }

  @Post('visitors/:visitId/check-out')
  @RequirePermission('visitors', 'edit')
  checkOutVisitor(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase5.checkOutVisitor(user.tenantId, branchId, user.userId, visitId);
  }
}
