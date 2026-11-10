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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SkipTenantTransaction } from '../../common/decorators/skip-tenant-transaction.decorator';
import {
  AttendanceQueryDto,
  CreateLeaveRequestDto,
  CreateMealPlanDto,
  CreateMealSubscriptionDto,
  CreateStudentGatePassDto,
  DecideLeaveRequestDto,
  DecideStudentGatePassDto,
  ExportFilterDto,
  MarkAttendanceDto,
  MarkMealAttendanceDto,
  RoomTransferDto,
  RoomTransferQueryDto,
  SetMealPlanActiveDto,
  UploadStudentDocumentDto,
} from './hostel-services.dto';
import { HostelServicesService } from './hostel-services.service';

type UploadedDocument = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@ApiTags('hostel services')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId', version: '1' })
export class HostelServicesController {
  constructor(private readonly services: HostelServicesService) {}

  @Get('attendance')
  @RequirePermission('attendance', 'view')
  listAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.services.listAttendance(user.tenantId, branchId, query);
  }

  @Get('attendance/report')
  @RequirePermission('attendance', 'view')
  attendanceReport(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.services.listAttendance(user.tenantId, branchId, query);
  }

  @Post('attendance')
  @RequirePermission('attendance', 'create')
  markAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.services.markAttendance(user.tenantId, branchId, user.userId, dto);
  }

  @Get('resident/attendance')
  @RequirePermission('attendance', 'view')
  listMyAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.services.listMyAttendance(user.tenantId, branchId, user.userId, query);
  }

  @Get('leave-requests')
  @RequirePermission('leave_requests', 'view')
  listLeaveRequests(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listLeaveRequests(user.tenantId, branchId);
  }

  @Get('resident/leave-requests')
  @RequirePermission('leave_requests', 'view')
  listMyLeaveRequests(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listMyLeaveRequests(user.tenantId, branchId, user.userId);
  }

  @Post('resident/leave-requests')
  @RequirePermission('leave_requests', 'create')
  createLeaveRequest(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.services.createLeaveRequest(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('leave-requests/:requestId/decision')
  @RequirePermission('leave_requests', 'approve')
  decideLeaveRequest(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: DecideLeaveRequestDto,
  ) {
    return this.services.decideLeaveRequest(
      user.tenantId,
      branchId,
      user.userId,
      requestId,
      dto,
    );
  }

  @Get('gate-passes')
  @RequirePermission('gate_passes', 'view')
  listGatePasses(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listGatePasses(user.tenantId, branchId);
  }

  @Get('resident/gate-passes')
  @RequirePermission('gate_passes', 'view')
  listMyGatePasses(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listMyGatePasses(user.tenantId, branchId, user.userId);
  }

  @Post('resident/gate-passes')
  @RequirePermission('gate_passes', 'create')
  createGatePass(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateStudentGatePassDto,
  ) {
    return this.services.createGatePass(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('gate-passes/:passId/decision')
  @RequirePermission('gate_passes', 'approve')
  decideGatePass(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('passId', ParseUUIDPipe) passId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: DecideStudentGatePassDto,
  ) {
    return this.services.decideGatePass(user.tenantId, branchId, user.userId, passId, dto);
  }

  @Post('gate-passes/:passId/return')
  @RequirePermission('gate_passes', 'verify')
  returnFromGatePass(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('passId', ParseUUIDPipe) passId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.recordGatePassReturn(user.tenantId, branchId, user.userId, passId);
  }

  @Get('meal-attendance')
  @RequirePermission('meal_attendance', 'view')
  listMealAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.services.listMealAttendance(user.tenantId, branchId, query, query.meal);
  }

  @Post('meal-attendance')
  @RequirePermission('meal_attendance', 'create')
  markMealAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: MarkMealAttendanceDto,
  ) {
    return this.services.markMealAttendance(user.tenantId, branchId, user.userId, dto);
  }

  @Get('resident/meal-attendance')
  @RequirePermission('meal_attendance', 'view')
  listMyMealAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.services.listMyMealAttendance(user.tenantId, branchId, user.userId, query);
  }

  @Get('meal-subscription-plans')
  @RequirePermission('meal_subscriptions', 'view')
  listMealPlans(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listMealPlans(user.tenantId, branchId);
  }

  @Post('meal-subscription-plans')
  @RequirePermission('meal_subscriptions', 'manage_settings')
  createMealPlan(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateMealPlanDto,
  ) {
    return this.services.createMealPlan(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('meal-subscription-plans/:planId')
  @RequirePermission('meal_subscriptions', 'manage_settings')
  setMealPlanActive(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetMealPlanActiveDto,
  ) {
    return this.services.setMealPlanActive(user.tenantId, branchId, planId, dto.isActive);
  }

  @Get('meal-subscriptions')
  @RequirePermission('meal_subscriptions', 'view')
  listMealSubscriptions(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listMealSubscriptions(user.tenantId, branchId);
  }

  @Get('resident/meal-subscriptions')
  @RequirePermission('meal_subscriptions', 'view')
  listMyMealSubscriptions(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listMyMealSubscriptions(user.tenantId, branchId, user.userId);
  }

  @Post('residents/:residentId/meal-subscriptions')
  @RequirePermission('meal_subscriptions', 'create')
  activateMealSubscription(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateMealSubscriptionDto,
  ) {
    return this.services.activateMealSubscription(
      user.tenantId,
      branchId,
      user.userId,
      residentId,
      dto,
    );
  }

  @Patch('meal-subscriptions/:subscriptionId/deactivate')
  @RequirePermission('meal_subscriptions', 'edit')
  deactivateMealSubscription(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.deactivateMealSubscription(user.tenantId, branchId, subscriptionId);
  }

  @Get('residents/:residentId/documents')
  @RequirePermission('student_documents', 'view')
  listResidentDocuments(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listResidentDocuments(user.tenantId, branchId, residentId);
  }

  @Get('resident/documents')
  @RequirePermission('student_documents', 'view')
  listMyDocuments(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listMyDocuments(user.tenantId, branchId, user.userId);
  }

  @Post('residents/:residentId/documents')
  @RequirePermission('student_documents', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadResidentDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadStudentDocumentDto,
    @UploadedFile() file: UploadedDocument,
  ) {
    return this.services.uploadResidentDocument(
      user.tenantId,
      branchId,
      user.userId,
      residentId,
      dto,
      file,
    );
  }

  @Post('resident/documents')
  @RequirePermission('student_documents', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async uploadMyDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadStudentDocumentDto,
    @UploadedFile() file: UploadedDocument,
  ) {
    const residentId = await this.services.getMyResidentId(user.tenantId, branchId, user.userId);
    return this.services.uploadResidentDocument(
      user.tenantId,
      branchId,
      user.userId,
      residentId,
      dto,
      file,
    );
  }

  @Put('residents/:residentId/documents/:documentId')
  @RequirePermission('student_documents', 'edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  replaceResidentDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadStudentDocumentDto,
    @UploadedFile() file: UploadedDocument,
  ) {
    return this.services.uploadResidentDocument(
      user.tenantId,
      branchId,
      user.userId,
      residentId,
      dto,
      file,
      documentId,
    );
  }

  @Put('resident/documents/:documentId')
  @RequirePermission('student_documents', 'edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async replaceMyDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadStudentDocumentDto,
    @UploadedFile() file: UploadedDocument,
  ) {
    const residentId = await this.services.getMyResidentId(user.tenantId, branchId, user.userId);
    return this.services.uploadResidentDocument(
      user.tenantId,
      branchId,
      user.userId,
      residentId,
      dto,
      file,
      documentId,
    );
  }

  @Get('residents/:residentId/documents/:documentId')
  @RequirePermission('student_documents', 'view')
  async downloadResidentDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.streamDocument(await this.services.downloadResidentDocument(
      user.tenantId,
      branchId,
      documentId,
      residentId,
    ));
  }

  @Get('resident/documents/:documentId')
  @RequirePermission('student_documents', 'view')
  async downloadMyDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.streamDocument(await this.services.downloadMyDocument(
      user.tenantId,
      branchId,
      user.userId,
      documentId,
    ));
  }

  @Delete('residents/:residentId/documents/:documentId')
  @RequirePermission('student_documents', 'delete')
  deleteResidentDocument(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.deleteResidentDocument(user.tenantId, branchId, documentId, residentId);
  }

  @Get('available-transfer-beds')
  @RequirePermission('allocations', 'view')
  listAvailableTransferBeds(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.services.listAvailableBeds(user.tenantId, branchId);
  }

  @Get('room-transfers')
  @RequirePermission('allocations', 'view')
  listRoomTransfers(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: RoomTransferQueryDto,
  ) {
    return this.services.listRoomTransfers(user.tenantId, branchId, filter.residentId);
  }

  @Post('residents/:residentId/room-transfers')
  @RequirePermission('allocations', 'assign')
  transferResidentRoom(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RoomTransferDto,
  ) {
    return this.services.transferResidentRoom(user.tenantId, branchId, user.userId, residentId, dto);
  }

  @Get('exports/residents')
  @RequirePermission('exports', 'export')
  @SkipTenantTransaction()
  exportResidents(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: ExportFilterDto,
  ) {
    return this.streamWorkbook(
      this.services.exportWorkbook(user.tenantId, branchId, user.userId, 'residents', filter),
    );
  }

  @Get('exports/admissions')
  @RequirePermission('exports', 'export')
  @SkipTenantTransaction()
  exportAdmissions(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: ExportFilterDto,
  ) {
    return this.streamWorkbook(
      this.services.exportWorkbook(user.tenantId, branchId, user.userId, 'admissions', filter),
    );
  }

  @Get('exports/attendance')
  @RequirePermission('exports', 'export')
  @SkipTenantTransaction()
  exportAttendance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: ExportFilterDto,
  ) {
    return this.streamWorkbook(
      this.services.exportWorkbook(user.tenantId, branchId, user.userId, 'attendance', filter),
    );
  }

  @Get('exports/finance')
  @RequirePermission('exports', 'export')
  @SkipTenantTransaction()
  exportFinance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: ExportFilterDto,
  ) {
    return this.streamWorkbook(
      this.services.exportWorkbook(user.tenantId, branchId, user.userId, 'finance', filter),
    );
  }

  private streamDocument(document: { buffer: Buffer; filename: string; mimeType: string }) {
    const filename = document.filename.replace(/[^A-Za-z0-9._-]/g, '_');
    return new StreamableFile(document.buffer, {
      type: document.mimeType,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  private async streamWorkbook(workbookPromise: ReturnType<HostelServicesService['exportWorkbook']>) {
    const workbook = await workbookPromise;
    return new StreamableFile(workbook.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${workbook.filename}"`,
    });
  }
}
