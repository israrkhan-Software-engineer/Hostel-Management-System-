import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BusinessPoliciesModule } from '../business-policies/business-policies.module';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';

@Module({
  imports: [AuditModule, BusinessPoliciesModule],
  controllers: [VisitorsController],
  providers: [VisitorsService],
})
export class VisitorsModule {}
