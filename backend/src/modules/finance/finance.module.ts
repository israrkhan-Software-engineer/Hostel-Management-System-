import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentProofStorageService } from '../../common/storage/payment-proof-storage.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceEnhancementsController } from './finance-enhancements.controller';
import { FinanceEnhancementsService } from './finance-enhancements.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [FinanceController, FinanceEnhancementsController],
  providers: [FinanceService, FinanceEnhancementsService, PaymentProofStorageService],
  exports: [FinanceService, FinanceEnhancementsService],
})
export class FinanceModule {}
