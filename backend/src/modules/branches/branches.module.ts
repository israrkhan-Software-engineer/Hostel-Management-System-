import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { BranchesController } from './branches.controller';

@Module({
  imports: [UsersModule, AuditModule],
  controllers: [BranchesController],
})
export class BranchesModule {}
