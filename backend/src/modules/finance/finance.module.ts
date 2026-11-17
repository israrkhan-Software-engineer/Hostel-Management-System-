import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentProofStorageModule } from '../../common/storage/payment-proof-storage.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceEnhancementsController } from './finance-enhancements.controller';
import { FinanceEnhancementsService } from './finance-enhancements.service';

@Module({
  imports: [AuditModule, NotificationsModule, PaymentProofStorageModule],
  controllers: [FinanceController, FinanceEnhancementsController],
  providers: [FinanceService, FinanceEnhancementsService],
  exports: [FinanceService, FinanceEnhancementsService],
})
export class FinanceModule {}
