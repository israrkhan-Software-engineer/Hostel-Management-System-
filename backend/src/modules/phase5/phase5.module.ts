import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { Phase5Controller } from './phase5.controller';
import { Phase5Service } from './phase5.service';

@Module({
  imports: [AuditModule],
  controllers: [Phase5Controller],
  providers: [Phase5Service],
})
export class Phase5Module {}
