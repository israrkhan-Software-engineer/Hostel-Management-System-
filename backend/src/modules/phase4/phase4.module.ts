import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Phase4Controller } from './phase4.controller';
import { Phase4Service } from './phase4.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [Phase4Controller],
  providers: [Phase4Service],
})
export class Phase4Module {}
