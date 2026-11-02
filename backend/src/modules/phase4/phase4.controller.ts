import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  CreateComplaintDto,
  CreateNoticeDto,
  SaveMessMenuDto,
  UpdateComplaintDto,
  UpdateNoticeDto,
} from './phase4.dto';
import { Phase4Service } from './phase4.service';

@ApiTags('mess, complaints, and notices')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId', version: '1' })
export class Phase4Controller {
  constructor(private readonly phase4: Phase4Service) {}

  @Get('mess-menus')
  @RequirePermission('mess', 'view')
  listMessMenus(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query('weekStart') weekStart: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.listMessMenus(user.tenantId, branchId, weekStart);
  }

  @Put('mess-menus')
  @RequirePermission('mess', 'edit')
  saveMessMenu(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SaveMessMenuDto,
  ) {
    return this.phase4.saveMessMenu(user.tenantId, branchId, user.userId, dto);
  }

  @Get('complaints')
  @RequirePermission('complaints', 'view')
  listMyComplaints(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.listMyComplaints(user.tenantId, branchId, user.userId);
  }

  @Get('complaints/queue')
  @RequirePermission('complaints', 'edit')
  listComplaintQueue(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.listComplaintQueue(user.tenantId, branchId);
  }

  @Post('complaints')
  @RequirePermission('complaints', 'create')
  createComplaint(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateComplaintDto,
  ) {
    return this.phase4.createComplaint(user.tenantId, branchId, user.userId, dto);
  }

  @Post('complaints/:complaintId/assign-to-me')
  @RequirePermission('complaints', 'assign')
  assignComplaintToSelf(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('complaintId', ParseUUIDPipe) complaintId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.assignComplaintToSelf(
      user.tenantId,
      branchId,
      user.userId,
      complaintId,
    );
  }

  @Patch('complaints/:complaintId')
  @RequirePermission('complaints', 'edit')
  updateComplaint(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('complaintId', ParseUUIDPipe) complaintId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateComplaintDto,
  ) {
    return this.phase4.updateComplaint(
      user.tenantId,
      branchId,
      user.userId,
      complaintId,
      dto,
    );
  }

  @Delete('complaints/:complaintId')
  @RequirePermission('complaints', 'delete')
  archiveComplaint(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('complaintId', ParseUUIDPipe) complaintId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.archiveComplaint(
      user.tenantId,
      branchId,
      user.userId,
      complaintId,
    );
  }

  @Get('notices')
  @RequirePermission('notices', 'view')
  listPublishedNotices(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.listPublishedNotices(user.tenantId, branchId);
  }

  @Get('notices/manage')
  @RequirePermission('notices', 'edit')
  listManagedNotices(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase4.listManagedNotices(user.tenantId, branchId);
  }

  @Post('notices')
  @RequirePermission('notices', 'create')
  createNotice(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateNoticeDto,
  ) {
    return this.phase4.createNotice(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('notices/:noticeId')
  @RequirePermission('notices', 'edit')
  updateNotice(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('noticeId', ParseUUIDPipe) noticeId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateNoticeDto,
  ) {
    return this.phase4.updateNotice(
      user.tenantId,
      branchId,
      user.userId,
      noticeId,
      dto,
    );
  }
}
