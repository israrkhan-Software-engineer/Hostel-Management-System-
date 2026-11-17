import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PaymentProofStorageModule } from '../../common/storage/payment-proof-storage.module';

@Module({
  imports: [TerminusModule, PrismaModule, PaymentProofStorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
