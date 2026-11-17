import { Module } from '@nestjs/common';
import { PaymentProofStorageService } from './payment-proof-storage.service';

@Module({
  providers: [PaymentProofStorageService],
  exports: [PaymentProofStorageService],
})
export class PaymentProofStorageModule {}
