import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RolesModule } from '../roles/roles.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HostelServicesController } from './hostel-services.controller';
import { HostelServicesService } from './hostel-services.service';

@Module({
  imports: [AuditModule, RolesModule, NotificationsModule],
  controllers: [HostelServicesController],
  providers: [HostelServicesService],
})
export class HostelServicesModule {}
