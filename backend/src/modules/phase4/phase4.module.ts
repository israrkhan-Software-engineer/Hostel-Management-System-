import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { Phase4Controller } from './phase4.controller';
import { Phase4Service } from './phase4.service';

@Module({
  imports: [AuditModule],
  controllers: [Phase4Controller],
  providers: [Phase4Service],
})
export class Phase4Module {}
