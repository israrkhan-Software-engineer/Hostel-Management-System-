import { PlatformInvoiceStatus, PlatformPaymentMethod } from '@prisma/client';
import { SaasService } from './saas.service';

describe('SaasService', () => {
  let service: SaasService;
  let prisma: {
    runWithPlatformContext: jest.Mock;
    $transaction: jest.Mock;
    platformPayment: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      runWithPlatformContext: jest.fn((_adminId, operation) => operation()),
      $transaction: jest.fn(),
      platformPayment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'payment-1', invoiceId: 'invoice-1', amountMinor: 500 }),
      },
    };
    service = new SaasService(prisma as never);
  });

  it('locks the invoice row before creating a payment', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'invoice-1',
          tenantId: 'tenant-1',
          amountMinor: 500,
          status: PlatformInvoiceStatus.PENDING,
        },
      ]),
      platformPayment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'payment-1', invoiceId: 'invoice-1', amountMinor: 500 }),
      },
      platformInvoice: {
        update: jest.fn().mockResolvedValue({ id: 'invoice-1', status: PlatformInvoiceStatus.PAID }),
      },
    };
    prisma.$transaction.mockImplementation(async (operation) => operation(tx));

    await service.recordPayment('admin-1', 'invoice-1', {
      amountMinor: 500,
      method: PlatformPaymentMethod.BANK_TRANSFER,
      idempotencyKey: 'payment-key-1',
      reference: 'REF-001',
      notes: 'Monthly subscription',
    });

    const sql = tx.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('platform_invoices');
    expect(tx.platformPayment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        invoiceId: 'invoice-1',
        amountMinor: 500,
        idempotencyKey: 'payment-key-1',
      }),
    }));
  });
});
