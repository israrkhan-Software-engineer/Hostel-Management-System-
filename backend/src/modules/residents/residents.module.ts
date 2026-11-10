import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { ResidentsController } from './residents.controller';
import { ResidentsService } from './residents.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [ResidentsController, AdmissionsController],
  providers: [ResidentsService, AdmissionsService],
  exports: [ResidentsService, AdmissionsService],
})
export class ResidentsModule {}
