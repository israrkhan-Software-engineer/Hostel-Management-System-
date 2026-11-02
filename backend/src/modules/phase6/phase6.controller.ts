import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { Phase6Service } from './phase6.service';

@ApiTags('offline sync and recovery')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId', version: '1' })
export class Phase6Controller {
  constructor(private readonly phase6: Phase6Service) {}

  @Get('offline-status')
  getOfflineStatus(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase6.getOfflineStatus(user.tenantId, branchId);
  }

  @Get('offline-dashboard')
  getOfflineDashboard(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase6.getOfflineDashboard(user.tenantId, branchId);
  }

  @Post('offline/sync-check')
  refreshOfflineStatus(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase6.refreshOfflineStatus(user.tenantId, branchId);
  }

  @Get('backup-verification')
  getBackupVerification(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase6.getBackupVerification(user.tenantId, branchId);
  }

  @Post('backup-verification')
  runBackupVerification(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.phase6.runBackupVerification(user.tenantId, branchId);
  }
}
