import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenantManagementController } from './tenant-management.controller';
import { TenantManagementService } from './tenant-management.service';

@Module({
  imports: [AuditModule],
  controllers: [TenantManagementController],
  providers: [TenantManagementService],
})
export class TenantManagementModule {}
