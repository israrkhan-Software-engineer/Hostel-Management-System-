import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BranchesController } from './branches.controller';

@Module({
  imports: [UsersModule],
  controllers: [BranchesController],
})
export class BranchesModule {}
