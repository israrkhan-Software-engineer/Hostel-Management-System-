import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { BusinessPoliciesController } from './business-policies.controller';
import { BusinessPoliciesService } from './business-policies.service';

@Module({
  imports: [PrismaModule, AuditModule, UsersModule],
  controllers: [BusinessPoliciesController],
  providers: [BusinessPoliciesService],
  exports: [BusinessPoliciesService],
})
export class BusinessPoliciesModule {}
