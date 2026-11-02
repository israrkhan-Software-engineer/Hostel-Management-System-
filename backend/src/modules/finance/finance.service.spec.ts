import { BadRequestException, ConflictException } from '@nestjs/common';
import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  let service: FinanceService;
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      resident: { findFirst: jest.fn().mockResolvedValue({ id: 'resident-1' }) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ currency: 'PKR', timezone: 'Asia/Karachi' }),
      },
      invoice: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      payment: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), aggregate: jest.fn() },
      refund: { create: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new FinanceService(prisma, audit as any);
  });

  it('creates an invoice with line totals and tenant currency', async () => {
    prisma.invoice.create.mockImplementation(async ({ data }: { data: Record<string, any> }) => ({
      ...data,
      id: data.id,
      status: 'ISSUED',
      resident: { id: 'resident-1', firstName: 'Test', lastName: 'Resident' },
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({ id: `line-${index}`, ...line })),
      payments: [],
      refunds: [],
    }));

    const invoice = await service.createInvoice('tenant-1', 'branch-1', 'user-1', {
      residentId: 'resident-1',
      lines: [
        { description: 'Boarding', quantity: 2, unitAmountMinor: 150000 },
        { description: 'Admission', quantity: 1, unitAmountMinor: 50000 },
      ],
    });

    expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        currency: 'PKR',
        lines: {
          create: [
            expect.objectContaining({ lineAmountMinor: 300000 }),
            expect.objectContaining({ lineAmountMinor: 50000 }),
          ],
        },
      }),
    }));
    expect(invoice.invoiceTotalMinor).toBe(350000);
    expect(invoice.balanceDueMinor).toBe(350000);
  });

  it('limits student invoice reads to the linked resident and omits proof bytes', async () => {
    prisma.invoice.findMany.mockResolvedValue([{
      id: 'invoice-1',
      status: 'ISSUED',
      lines: [{ lineAmountMinor: 120000 }],
      payments: [{
        id: 'payment-1',
        amountMinor: 120000,
        status: 'PENDING',
        proofFileName: 'receipt.png',
        proofData: Buffer.from('private'),
      }],
      refunds: [],
    }]);

    const invoices = await service.listResidentInvoices('tenant-1', 'branch-1', 'student-1');

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', branchId: 'branch-1', residentId: 'resident-1', deletedAt: null },
      include: expect.objectContaining({
        payments: expect.objectContaining({
          select: expect.not.objectContaining({ proofData: true }),
        }),
      }),
    }));
    expect(invoices[0].payments[0]).toMatchObject({ proofAvailable: true });
    expect(invoices[0].payments[0]).not.toHaveProperty('proofData');
  });

  it('rejects invalid proof file signatures before starting a payment transaction', async () => {
    await expect(service.submitResidentPayment(
      'tenant-1',
      'branch-1',
      'student-1',
      'invoice-1',
      {
        amountMinor: 10000,
        method: 'BANK_TRANSFER',
        submissionKey: '550e8400-e29b-41d4-a716-446655440000',
      },
      {
        size: 5,
        mimetype: 'image/png',
        originalname: 'receipt.png',
        buffer: Buffer.from('wrong'),
      },
    )).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('generates a PDF from an existing invoice without creating another invoice', async () => {
    const issuedAt = new Date('2026-10-26T00:00:00.000Z');
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'invoice-1',
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      residentId: 'resident-1',
      invoiceNumber: 'HMS-2026-001',
      currency: 'PKR',
      status: 'ISSUED',
      issuedAt,
      dueAt: new Date('2026-11-05T00:00:00.000Z'),
      resident: { id: 'resident-1', firstName: 'Amina', lastName: 'Khan' },
      lines: [{ id: 'line-1', description: 'Boarding', quantity: 1, unitAmountMinor: 50000, lineAmountMinor: 50000 }],
      payments: [{ id: 'payment-1', amountMinor: 10000, status: 'VERIFIED', method: 'CASH', createdAt: issuedAt }],
      refunds: [{ id: 'refund-1', amountMinor: 1000, method: 'CASH', createdAt: issuedAt }],
    });
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Sunrise Hostel' });
    prisma.invoice.findMany.mockResolvedValue([{
      lines: [{ lineAmountMinor: 20000 }],
      payments: [{ amountMinor: 5000 }],
      refunds: [],
    }]);

    const first = await service.generateInvoicePdf('tenant-1', 'branch-1', 'invoice-1');
    const second = await service.generateInvoicePdf('tenant-1', 'branch-1', 'invoice-1');

    expect(first.invoiceNumber).toBe('HMS-2026-001');
    expect(first.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(second.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.invoice.findFirst).toHaveBeenCalledTimes(2);
  });

  it('rejects invoice lines whose totals exceed the database integer range', async () => {
    await expect(service.createInvoice('tenant-1', 'branch-1', 'user-1', {
      residentId: 'resident-1',
      lines: [{ description: 'Invalid', quantity: 2, unitAmountMinor: 1_500_000_000 }],
    })).rejects.toThrow(BadRequestException);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('does not allow refunds to exceed verified payments less prior refunds', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
      payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 10000 } }) },
      refund: {
        findFirst: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 2000 } }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.recordRefund('tenant-1', 'branch-1', 'user-1', 'invoice-1', {
      amountMinor: 8001,
      method: 'CASH',
      submissionKey: '550e8400-e29b-41d4-a716-446655440000',
    })).rejects.toThrow(ConflictException);
    expect(tx.refund.create).not.toHaveBeenCalled();
  });

  it('returns the original payment on an idempotent retry without creating or auditing twice', async () => {
    const savedPayment = {
      id: 'payment-1',
      amountMinor: 5000,
      method: 'CASH',
      reference: 'receipt-1',
      proofNotes: 'cash received',
      status: 'PENDING',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
      payment: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(savedPayment),
        create: jest.fn().mockResolvedValue(savedPayment),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'invoice-1',
      status: 'ISSUED',
      lines: [{ lineAmountMinor: 5000 }],
      payments: [{ amountMinor: 5000, status: 'PENDING' }],
      refunds: [],
    });
    const payment = {
      amountMinor: 5000,
      method: 'CASH',
      reference: 'receipt-1',
      proofNotes: 'cash received',
      submissionKey: '550e8400-e29b-41d4-a716-446655440000',
    } as const;

    await service.recordPayment('tenant-1', 'branch-1', 'user-1', 'invoice-1', payment);
    await service.recordPayment('tenant-1', 'branch-1', 'user-1', 'invoice-1', payment);

    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ submissionKey: payment.submissionKey }),
    }));
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('rejects reusing a payment idempotency key with different values', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          amountMinor: 5000,
          method: 'CASH',
          reference: null,
          proofNotes: null,
        }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));

    await expect(service.recordPayment('tenant-1', 'branch-1', 'user-1', 'invoice-1', {
      amountMinor: 6000,
      method: 'CASH',
      submissionKey: '550e8400-e29b-41d4-a716-446655440000',
    } as const)).rejects.toThrow(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('returns the original refund on an idempotent retry without recording another refund', async () => {
    const savedRefund = {
      id: 'refund-1',
      amountMinor: 2500,
      method: 'BANK_TRANSFER',
      reference: 'return-1',
      notes: 'approved refund',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
      payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 5000 } }) },
      refund: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(savedRefund),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 0 } }),
        create: jest.fn().mockResolvedValue(savedRefund),
      },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'invoice-1',
      status: 'ISSUED',
      lines: [{ lineAmountMinor: 5000 }],
      payments: [{ amountMinor: 5000, status: 'VERIFIED' }],
      refunds: [{ amountMinor: 2500 }],
    });
    const refund = {
      amountMinor: 2500,
      method: 'BANK_TRANSFER',
      reference: 'return-1',
      notes: 'approved refund',
      submissionKey: '550e8400-e29b-41d4-a716-446655440001',
    } as const;

    await service.recordRefund('tenant-1', 'branch-1', 'user-1', 'invoice-1', refund);
    await service.recordRefund('tenant-1', 'branch-1', 'user-1', 'invoice-1', refund);

    expect(tx.refund.create).toHaveBeenCalledTimes(1);
    expect(tx.refund.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ submissionKey: refund.submissionKey }),
    }));
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('calculates outstanding balance and overpayment credit from verified payments', async () => {
    const invoice = service['presentInvoice']({
      status: 'ISSUED',
      lines: [{ lineAmountMinor: 10000 }],
      payments: [
        { amountMinor: 12000, status: 'VERIFIED' as const },
        { amountMinor: 3000, status: 'PENDING' as const },
      ],
      refunds: [{ amountMinor: 1000 }],
    });

    expect(invoice).toMatchObject({
      invoiceTotalMinor: 10000,
      verifiedPaymentsMinor: 12000,
      refundedMinor: 1000,
      balanceDueMinor: 0,
      creditMinor: 1000,
    });
  });

  it('rejects out-of-order report dates before querying report data', async () => {
    await expect(service.getReport('tenant-1', 'branch-1', {
      from: '2026-10-22',
      to: '2026-10-21',
    })).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns scoped finance-period totals and current outstanding invoices', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{
        invoiceCount: 1,
        issuedInvoiceCount: 1,
        issuedAmountMinor: '10000',
        outstandingInvoiceCount: 1,
        outstandingAmountMinor: '6000',
        overdueInvoiceCount: 0,
        overdueAmountMinor: '0',
        verifiedPaymentsMinor: '4000',
        pendingPaymentsMinor: '1000',
        refundsMinor: '0',
      }])
      .mockResolvedValueOnce([{
        invoiceNumber: 'HMS-TEST',
        residentName: 'Test Resident',
        dueAt: null,
        currency: 'PKR',
        balanceDueMinor: '6000',
        creditMinor: '0',
      }]);

    const report = await service.getReport('tenant-1', 'branch-1', {
      from: '2026-10-01',
      to: '2026-10-22',
    });

    expect(report).toMatchObject({
      currency: 'PKR',
      issuedInvoiceCount: 1,
      issuedAmountMinor: 10000,
      verifiedPaymentsMinor: 4000,
      pendingPaymentsMinor: 1000,
      outstandingInvoiceCount: 1,
      outstandingAmountMinor: 6000,
      overdueInvoiceCount: 0,
      overdueAmountMinor: 0,
      outstandingInvoices: [{ invoiceNumber: 'HMS-TEST', balanceDueMinor: 6000 }],
    });
    const [summaryQuery, ...summaryValues] = prisma.$queryRaw.mock.calls[0];
    expect(summaryQuery.join(' ')).toContain("date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE");
    expect(summaryValues).toContain('Asia/Karachi');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('voids an invoice only when it has no pending, verified, or refunded payments', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ id: 'invoice-1', status: 'ISSUED' }),
        update: jest.fn(),
      },
      payment: { count: jest.fn().mockResolvedValue(0) },
      refund: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'invoice-1',
      status: 'VOID',
      lines: [],
      payments: [],
      refunds: [],
      resident: {},
    });

    const result = await service.voidInvoice('tenant-1', 'branch-1', 'user-1', 'invoice-1');

    expect(tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: { status: 'VOID' },
    });
    expect(result.balanceDueMinor).toBe(0);
  });
});
