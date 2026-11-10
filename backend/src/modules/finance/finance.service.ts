import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import PDFDocument = require('pdfkit');
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PaymentProofStorageService } from '../../common/storage/payment-proof-storage.service';
import { hasPrismaErrorCode } from '../../common/utils/prisma-error.util';
import {
  CreateInvoiceDto,
  FinanceReportFilterDto,
  RecordPaymentDto,
  RecordRefundDto,
  ReviewPaymentDto,
  SubmitResidentPaymentDto,
  UploadedPaymentProof,
} from './finance.dto';

const MAX_AMOUNT_MINOR = 2_147_483_647;

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly proofStorage?: PaymentProofStorageService,
  ) {}

  async listInvoices(tenantId: string, branchId: string, status?: InvoiceStatus) {
    await this.ensureBranch(tenantId, branchId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        payments: {
          select: {
            id: true,
            amountMinor: true,
            method: true,
            status: true,
            reference: true,
            proofNotes: true,
            proofFileName: true,
            proofMimeType: true,
            rejectionReason: true,
            createdAt: true,
            verifiedAt: true,
            verifiedByUserId: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 100,
    });
    return invoices.map((invoice) => this.presentInvoice(invoice));
  }

  async listResidentInvoices(tenantId: string, branchId: string, userId: string) {
    await this.ensureBranch(tenantId, branchId);
    const resident = await this.prisma.resident.findFirst({
      where: { tenantId, branchId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Student account is not linked to a resident record');
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, branchId, residentId: resident.id, deletedAt: null },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        payments: {
          select: {
            id: true,
            amountMinor: true,
            method: true,
            status: true,
            reference: true,
            proofNotes: true,
            proofFileName: true,
            proofMimeType: true,
            rejectionReason: true,
            createdAt: true,
            verifiedAt: true,
            verifiedByUserId: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 100,
    });
    return invoices.map((invoice) => this.presentInvoice(invoice));
  }

  async submitResidentPayment(
    tenantId: string,
    branchId: string,
    userId: string,
    invoiceId: string,
    dto: SubmitResidentPaymentDto,
    file: UploadedPaymentProof,
  ) {
    if (!file?.buffer?.length || file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Payment proof must be a file no larger than 5 MB');
    }
    this.validateProofFile(file);

    const resident = await this.prisma.runWithTenantContext(tenantId, async () => {
      await this.ensureBranch(tenantId, branchId);
      return this.prisma.resident.findFirst({
        where: { tenantId, branchId, userId, deletedAt: null },
        select: { id: true },
      });
    });
    if (!resident) throw new NotFoundException('Student account is not linked to a resident record');
    if (!this.proofStorage) {
      throw new ServiceUnavailableException('Payment proof storage is unavailable; configure the private object-storage provider.');
    }

    const reference = dto.reference?.trim() || null;
    const proofNotes = dto.proofNotes?.trim() || null;
    const proofHash = createHash('sha256').update(file.buffer).digest('hex');
    const proofStorageKey = `payment-proofs/${tenantId}/${randomUUID()}`;
    let uploadedObjectPending = true;
    try {
      await this.proofStorage.put(proofStorageKey, file.buffer, file.mimetype, proofHash);
      const result = await this.prisma.runWithTenantContext(tenantId, () => (
        this.prisma.$transaction(async (tx) => {
          const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM invoices
            WHERE id = ${invoiceId}::uuid
              AND tenant_id = ${tenantId}::uuid
              AND branch_id = ${branchId}::uuid
              AND resident_id = ${resident.id}::uuid
              AND status = 'ISSUED'
              AND deleted_at IS NULL
            FOR UPDATE
          `;
          if (!invoiceRows.length) throw new NotFoundException('Issued invoice not found');

          const existing = await tx.payment.findFirst({
            where: {
              tenantId,
              branchId,
              invoiceId,
              recordedByUserId: userId,
              submissionKey: dto.submissionKey,
            },
            select: {
              id: true,
              amountMinor: true,
              method: true,
              reference: true,
              proofNotes: true,
              proofFileName: true,
              proofMimeType: true,
              proofSha256: true,
              proofData: true,
            },
          });
          if (existing) {
            const existingProofHash = existing.proofSha256
              ?? (existing.proofData ? createHash('sha256').update(existing.proofData).digest('hex') : null);
            if (
              existing.amountMinor !== dto.amountMinor
              || existing.method !== dto.method
              || existing.reference !== reference
              || existing.proofNotes !== proofNotes
              || existing.proofFileName !== this.safeProofFileName(file.originalname)
              || existing.proofMimeType !== file.mimetype
              || existingProofHash !== proofHash
            ) {
              throw new ConflictException('Payment submission key was already used for different payment details');
            }
            return { id: existing.id, created: false };
          }

          const [invoiceAmount, verifiedPayments, pendingPayments, refunds] = await Promise.all([
            tx.invoiceLine.aggregate({
              where: { tenantId, branchId, invoiceId },
              _sum: { lineAmountMinor: true },
            }),
            tx.payment.aggregate({
              where: { tenantId, branchId, invoiceId, status: 'VERIFIED' },
              _sum: { amountMinor: true },
            }),
            tx.payment.aggregate({
              where: { tenantId, branchId, invoiceId, status: 'PENDING' },
              _sum: { amountMinor: true },
            }),
            tx.refund.aggregate({
              where: { tenantId, branchId, invoiceId },
              _sum: { amountMinor: true },
            }),
          ]);
          const due = Math.max(
            (invoiceAmount._sum.lineAmountMinor ?? 0)
              - (verifiedPayments._sum.amountMinor ?? 0)
              + (refunds._sum.amountMinor ?? 0)
              - (pendingPayments._sum.amountMinor ?? 0),
            0,
          );
          if (dto.amountMinor > due) {
            throw new BadRequestException('Payment amount exceeds the invoice balance available for verification');
          }
          const payment = await tx.payment.create({
            data: {
              tenantId,
              branchId,
              invoiceId,
              amountMinor: dto.amountMinor,
              method: dto.method,
              reference,
              proofNotes,
              submissionKey: dto.submissionKey,
              proofFileName: this.safeProofFileName(file.originalname),
              proofMimeType: file.mimetype,
              proofStorageKey,
              proofSha256: proofHash,
              recordedByUserId: userId,
            },
            select: { id: true },
          });
          return { id: payment.id, created: true };
        })
      ));

      if (!result.created) {
        await this.proofStorage.delete(proofStorageKey);
        uploadedObjectPending = false;
      } else {
        uploadedObjectPending = false;
        await this.prisma.runWithTenantContext(tenantId, () => this.audit.log({
          tenantId,
          branchId,
          actorUserId: userId,
          action: 'payment.proof.submit',
          module: 'payment_proofs',
          entityType: 'payment',
          entityId: result.id,
          outcome: 'success',
          metadata: { amountMinor: dto.amountMinor, method: dto.method, fileName: this.safeProofFileName(file.originalname) },
        }));
      }
      return this.prisma.runWithTenantContext(tenantId, () => this.getInvoice(tenantId, branchId, invoiceId));
    } catch (error) {
      if (uploadedObjectPending) {
        try {
          await this.proofStorage.delete(proofStorageKey);
        } catch (cleanupError) {
          this.logger.error(
            `Could not remove unreferenced payment proof object ${proofStorageKey}: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        }
      }
      throw error;
    }
  }

  async getResidentPaymentProof(
    tenantId: string,
    branchId: string,
    userId: string,
    paymentId: string,
  ) {
    const payment = await this.prisma.runWithTenantContext(tenantId, async () => {
      await this.ensureBranch(tenantId, branchId);
      return this.prisma.payment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          branchId,
          invoice: { resident: { userId } },
        },
        select: {
          proofData: true,
          proofStorageKey: true,
          proofSha256: true,
          proofFileName: true,
          proofMimeType: true,
        },
      });
    });
    return this.loadPaymentProof(payment);
  }

  async getPaymentProof(tenantId: string, branchId: string, paymentId: string) {
    const payment = await this.prisma.runWithTenantContext(tenantId, async () => {
      await this.ensureBranch(tenantId, branchId);
      return this.prisma.payment.findFirst({
        where: { id: paymentId, tenantId, branchId },
        select: {
          proofData: true,
          proofStorageKey: true,
          proofSha256: true,
          proofFileName: true,
          proofMimeType: true,
        },
      });
    });
    return this.loadPaymentProof(payment);
  }

  private async loadPaymentProof(
    payment: {
      proofData: Uint8Array | null;
      proofStorageKey: string | null;
      proofSha256: string | null;
      proofFileName: string | null;
      proofMimeType: string | null;
    } | null,
  ) {
    if (!payment?.proofFileName || !payment.proofMimeType) {
      throw new NotFoundException('Payment proof not found');
    }
    if (payment.proofData) return payment;
    if (!payment.proofStorageKey) throw new NotFoundException('Payment proof not found');
    if (!this.proofStorage) {
      throw new ServiceUnavailableException('Payment proof storage is unavailable');
    }
    const proofData = await this.proofStorage.get(payment.proofStorageKey);
    if (payment.proofSha256 && createHash('sha256').update(proofData).digest('hex') !== payment.proofSha256) {
      throw new ServiceUnavailableException('Stored payment proof failed its integrity check');
    }
    return {
      ...payment,
      proofData,
    };
  }

  async getInvoice(tenantId: string, branchId: string, invoiceId: string) {
    await this.ensureBranch(tenantId, branchId);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId, branchId, deletedAt: null },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        payments: {
          select: {
            id: true,
            amountMinor: true,
            method: true,
            status: true,
            reference: true,
            proofNotes: true,
            proofFileName: true,
            proofMimeType: true,
            rejectionReason: true,
            createdAt: true,
            verifiedAt: true,
            verifiedByUserId: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.presentInvoice(invoice);
  }

  async generateInvoicePdf(tenantId: string, branchId: string, invoiceId: string) {
    const { invoice, tenantName, previousBalanceMinor } = await this.prisma.runWithTenantContext(
      tenantId,
      async () => {
        const invoice = await this.getInvoice(tenantId, branchId, invoiceId);
        const [tenant, priorInvoices] = await Promise.all([
          this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
          this.prisma.invoice.findMany({
            where: {
              tenantId,
              branchId,
              residentId: invoice.residentId,
              status: 'ISSUED',
              deletedAt: null,
              issuedAt: { lt: invoice.issuedAt },
            },
            include: {
              lines: { select: { lineAmountMinor: true } },
              payments: { where: { status: 'VERIFIED' }, select: { amountMinor: true } },
              refunds: { select: { amountMinor: true } },
            },
          }),
        ]);
        const previousBalanceMinor = priorInvoices.reduce((sum, prior) => {
          const total = prior.lines.reduce((lineSum, line) => lineSum + line.lineAmountMinor, 0);
          const paid = prior.payments.reduce((paymentSum, payment) => paymentSum + payment.amountMinor, 0);
          const refunded = prior.refunds.reduce((refundSum, refund) => refundSum + refund.amountMinor, 0);
          return sum + Math.max(total - paid + refunded, 0);
        }, 0);
        return { invoice, tenantName: tenant?.name ?? 'Hostel', previousBalanceMinor };
      },
    );
    const money = (amountMinor: number) => new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: invoice.currency,
    }).format(amountMinor / 100);
    const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : 'Not specified';

    const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${invoice.invoiceNumber}` } });
    const chunks: Buffer[] = [];
    const buffer = new Promise<Buffer>((resolve, reject) => {
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });

    document.fontSize(20).text(tenantName, { align: 'center' });
    document.moveDown(0.4).fontSize(15).text('INVOICE', { align: 'center' });
    document.moveDown();
    document.fontSize(10).text(`Invoice number: ${invoice.invoiceNumber}`);
    document.text(`Resident: ${invoice.resident.firstName} ${invoice.resident.lastName}`);
    document.text(`Issued: ${date(invoice.issuedAt)}    Due: ${date(invoice.dueAt)}`);
    document.text(`Currency: ${invoice.currency}`);
    document.moveDown();
    document.fontSize(12).text('Charges', { underline: true });
    document.moveDown(0.3).fontSize(10);
    invoice.lines.forEach((line) => {
      document.text(`${line.description} | Qty ${line.quantity} | ${money(line.unitAmountMinor)} each | ${money(line.lineAmountMinor)}`);
    });
    document.moveDown(0.5);
    document.text(`Invoice total: ${money(invoice.invoiceTotalMinor)}`, { align: 'right' });
    document.text(`Previous balance: ${money(previousBalanceMinor)}`, { align: 'right' });
    document.text(`Payments verified: ${money(invoice.verifiedPaymentsMinor)}`, { align: 'right' });
    document.text(`Refunds: ${money(invoice.refundedMinor)}`, { align: 'right' });
    document.font('Helvetica-Bold').text(
      `Outstanding balance including previous balance: ${money(previousBalanceMinor + invoice.balanceDueMinor)}`,
      { align: 'right' },
    );
    document.font('Helvetica').moveDown();

    if (invoice.payments.length) {
      document.fontSize(12).text('Payment history', { underline: true });
      document.moveDown(0.3).fontSize(10);
      invoice.payments.forEach((payment) => {
        document.text(`${date(payment.createdAt)} | ${payment.method} | ${payment.status} | ${money(payment.amountMinor)}${payment.reference ? ` | ${payment.reference}` : ''}`);
      });
      document.moveDown(0.5);
    }
    if (invoice.refunds.length) {
      document.fontSize(12).text('Refund history', { underline: true });
      document.moveDown(0.3).fontSize(10);
      invoice.refunds.forEach((refund) => {
        document.text(`${date(refund.createdAt)} | ${refund.method} | ${money(refund.amountMinor)}`);
      });
    }
    document.end();

    return {
      invoiceNumber: invoice.invoiceNumber,
      buffer: await buffer,
    };
  }

  async getReport(tenantId: string, branchId: string, filter: FinanceReportFilterDto) {
    await this.ensureBranch(tenantId, branchId);
    const from = new Date(filter.from);
    const to = new Date(filter.to);
    const endExclusive = new Date(to);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to ||
      endExclusive.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException('Report dates must be ordered and span no more than 366 days');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true, timezone: true },
    });
    if (!tenant) throw new NotFoundException('Finance report data not found');

    const [summaryRows, outstandingRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        issuedInvoiceCount: number;
        issuedAmountMinor: string;
        outstandingInvoiceCount: number;
        outstandingAmountMinor: string;
        overdueInvoiceCount: number;
        overdueAmountMinor: string;
        verifiedPaymentsMinor: string;
        pendingPaymentsMinor: string;
        refundsMinor: string;
      }>>`
        WITH invoice_amounts AS (
          SELECT i.id, i.issued_at, i.due_at,
            COALESCE(SUM(l.line_amount_minor), 0)::BIGINT AS total_minor,
            COALESCE((
              SELECT SUM(p.amount_minor) FROM payments p
              WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id
                AND p.branch_id = i.branch_id AND p.status = 'VERIFIED'
            ), 0)::BIGINT AS paid_minor,
            COALESCE((
              SELECT SUM(rf.amount_minor) FROM refunds rf
              WHERE rf.invoice_id = i.id AND rf.tenant_id = i.tenant_id
                AND rf.branch_id = i.branch_id
            ), 0)::BIGINT AS refunded_minor
          FROM invoices i
          LEFT JOIN invoice_lines l ON l.invoice_id = i.id
            AND l.tenant_id = i.tenant_id AND l.branch_id = i.branch_id
          WHERE i.tenant_id = ${tenantId}::uuid
            AND i.branch_id = ${branchId}::uuid
            AND i.status = 'ISSUED' AND i.deleted_at IS NULL
          GROUP BY i.id
        ),
        payment_period AS (
          SELECT
            COALESCE(SUM(amount_minor) FILTER (WHERE status = 'VERIFIED'), 0)::BIGINT AS verified_minor,
            COALESCE(SUM(amount_minor) FILTER (WHERE status = 'PENDING'), 0)::BIGINT AS pending_minor
          FROM payments
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND created_at >= ${from} AND created_at < ${endExclusive}
        ),
        refund_period AS (
          SELECT COALESCE(SUM(amount_minor), 0)::BIGINT AS refunded_minor
          FROM refunds
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND created_at >= ${from} AND created_at < ${endExclusive}
        )
        SELECT
          COUNT(*) FILTER (WHERE issued_at >= ${from} AND issued_at < ${endExclusive})::INTEGER AS "issuedInvoiceCount",
          COALESCE(SUM(total_minor) FILTER (WHERE issued_at >= ${from} AND issued_at < ${endExclusive}), 0)::TEXT AS "issuedAmountMinor",
          COUNT(*) FILTER (WHERE GREATEST(total_minor - paid_minor + refunded_minor, 0) > 0)::INTEGER AS "outstandingInvoiceCount",
          COALESCE(SUM(GREATEST(total_minor - paid_minor + refunded_minor, 0)), 0)::TEXT AS "outstandingAmountMinor",
          COUNT(*) FILTER (
            WHERE due_at < (
              date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE ${tenant.timezone})
              AT TIME ZONE ${tenant.timezone}
            )
            AND GREATEST(total_minor - paid_minor + refunded_minor, 0) > 0
          )::INTEGER AS "overdueInvoiceCount",
          COALESCE(SUM(GREATEST(total_minor - paid_minor + refunded_minor, 0)) FILTER (
            WHERE due_at < (
              date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE ${tenant.timezone})
              AT TIME ZONE ${tenant.timezone}
            )
          ), 0)::TEXT AS "overdueAmountMinor",
          (SELECT verified_minor::TEXT FROM payment_period) AS "verifiedPaymentsMinor",
          (SELECT pending_minor::TEXT FROM payment_period) AS "pendingPaymentsMinor",
          (SELECT refunded_minor::TEXT FROM refund_period) AS "refundsMinor"
        FROM invoice_amounts
      `,
      this.prisma.$queryRaw<Array<{
        invoiceNumber: string;
        residentName: string;
        dueAt: Date | null;
        currency: string;
        balanceDueMinor: string;
        creditMinor: string;
      }>>`
        WITH invoice_amounts AS (
          SELECT i.id, i.invoice_number, i.due_at, i.currency,
            r.first_name || ' ' || r.last_name AS resident_name,
            COALESCE(SUM(l.line_amount_minor), 0)::BIGINT AS total_minor,
            COALESCE((
              SELECT SUM(p.amount_minor) FROM payments p
              WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id
                AND p.branch_id = i.branch_id AND p.status = 'VERIFIED'
            ), 0)::BIGINT AS paid_minor,
            COALESCE((
              SELECT SUM(rf.amount_minor) FROM refunds rf
              WHERE rf.invoice_id = i.id AND rf.tenant_id = i.tenant_id
                AND rf.branch_id = i.branch_id
            ), 0)::BIGINT AS refunded_minor
          FROM invoices i
          JOIN residents r ON r.id = i.resident_id AND r.tenant_id = i.tenant_id
            AND r.branch_id = i.branch_id
          LEFT JOIN invoice_lines l ON l.invoice_id = i.id
            AND l.tenant_id = i.tenant_id AND l.branch_id = i.branch_id
          WHERE i.tenant_id = ${tenantId}::uuid
            AND i.branch_id = ${branchId}::uuid
            AND i.status = 'ISSUED' AND i.deleted_at IS NULL
          GROUP BY i.id, r.first_name, r.last_name
        )
        SELECT invoice_number AS "invoiceNumber", resident_name AS "residentName",
          due_at AS "dueAt", currency,
          GREATEST(total_minor - paid_minor + refunded_minor, 0)::TEXT AS "balanceDueMinor",
          GREATEST(paid_minor - refunded_minor - total_minor, 0)::TEXT AS "creditMinor"
        FROM invoice_amounts
        WHERE GREATEST(total_minor - paid_minor + refunded_minor, 0) > 0
        ORDER BY due_at ASC NULLS LAST, invoice_number ASC
        LIMIT 100
      `,
    ]);
    const summary = summaryRows[0];
    if (!summary) throw new NotFoundException('Finance report data not found');

    return {
      from: filter.from,
      to: filter.to,
      currency: tenant.currency,
      issuedInvoiceCount: summary.issuedInvoiceCount,
      issuedAmountMinor: Number(summary.issuedAmountMinor),
      verifiedPaymentsMinor: Number(summary.verifiedPaymentsMinor),
      pendingPaymentsMinor: Number(summary.pendingPaymentsMinor),
      refundsMinor: Number(summary.refundsMinor),
      outstandingInvoiceCount: summary.outstandingInvoiceCount,
      outstandingAmountMinor: Number(summary.outstandingAmountMinor),
      overdueInvoiceCount: summary.overdueInvoiceCount,
      overdueAmountMinor: Number(summary.overdueAmountMinor),
      outstandingInvoices: outstandingRows.map((row) => ({
        invoiceNumber: row.invoiceNumber,
        residentName: row.residentName,
        dueAt: row.dueAt,
        currency: row.currency,
        balanceDueMinor: Number(row.balanceDueMinor),
        creditMinor: Number(row.creditMinor),
      })),
      outstandingInvoicesTruncated: summary.outstandingInvoiceCount > outstandingRows.length,
    };
  }

  async voidInvoice(tenantId: string, branchId: string, actorUserId: string, invoiceId: string) {
    await this.ensureBranch(tenantId, branchId);
    await this.prisma.$transaction(async (tx) => {
      const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM invoices
        WHERE id = ${invoiceId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!invoiceRows.length) throw new NotFoundException('Invoice not found');

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId, branchId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'ISSUED') {
        throw new ConflictException('Only issued invoices can be voided');
      }

      const [payments, refunds] = await Promise.all([
        tx.payment.count({ where: { tenantId, branchId, invoiceId, status: { not: 'REJECTED' } } }),
        tx.refund.count({ where: { tenantId, branchId, invoiceId } }),
      ]);
      if (payments || refunds) {
        throw new ConflictException('Invoices with pending, verified, or refunded payments cannot be voided');
      }
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'VOID' },
      });
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'invoice.void',
      module: 'invoices',
      entityType: 'invoice',
      entityId: invoiceId,
      outcome: 'success',
    });
    return this.getInvoice(tenantId, branchId, invoiceId);
  }

  async createInvoice(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateInvoiceDto,
    feeAssignmentId?: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const lineData = dto.lines.map((line) => {
      const lineAmountMinor = line.quantity * line.unitAmountMinor;
      if (!Number.isSafeInteger(lineAmountMinor) || lineAmountMinor > MAX_AMOUNT_MINOR) {
        throw new BadRequestException('Invoice line total exceeds the supported amount');
      }
      return {
        description: line.description.trim(),
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor,
        lineAmountMinor,
      };
    });
    const invoiceTotal = lineData.reduce((sum, line) => sum + line.lineAmountMinor, 0);
    if (!Number.isSafeInteger(invoiceTotal) || invoiceTotal > MAX_AMOUNT_MINOR) {
      throw new BadRequestException('Invoice total exceeds the supported amount');
    }

    const [resident, tenant] = await Promise.all([
      this.prisma.resident.findFirst({
        where: { id: dto.residentId, tenantId, branchId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, userId: true },
      }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    ]);
    if (!resident) throw new NotFoundException('Active resident not found in this branch');
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (feeAssignmentId) {
      const alreadyInvoiced = await this.prisma.invoice.findFirst({
        where: { tenantId, branchId, feeAssignmentId, deletedAt: null },
        select: { id: true },
      });
      if (alreadyInvoiced) throw new ConflictException('This fee assignment already has an invoice');
    }

    const invoiceId = randomUUID();
    const invoiceNumber = `HMS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${invoiceId.slice(0, 8).toUpperCase()}`;
    let invoice;
    try {
      invoice = await this.prisma.invoice.create({
      data: {
        id: invoiceId,
        tenantId,
        branchId,
        residentId: resident.id,
        invoiceNumber,
        currency: tenant.currency,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        notes: dto.notes?.trim() || null,
        createdByUserId: actorUserId,
        ...(feeAssignmentId ? { feeAssignmentId } : {}),
        lines: { create: lineData.map((line) => ({ ...line, tenantId, branchId })) },
      },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        lines: true,
        payments: true,
        refunds: true,
      },
      });
    } catch (error) {
      if (feeAssignmentId && hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('This fee assignment already has an invoice');
      }
      throw error;
    }
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'invoice.create',
      module: 'invoices',
      entityType: 'invoice',
      entityId: invoice.id,
      outcome: 'success',
      metadata: { invoiceNumber, amountMinor: invoiceTotal, currency: tenant.currency },
    });
    const invoiceMessage = `Invoice ${invoiceNumber} has been generated for ${new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: tenant.currency,
    }).format(invoiceTotal / 100)}.`;
    if (resident.userId && this.notifications) {
      await this.notifications.notifyUser({
        tenantId,
        branchId,
        userId: resident.userId,
        category: 'finance',
        title: 'New invoice generated',
        body: invoiceMessage,
        ...(resident.email ? {
          email: {
            to: resident.email,
            subject: `New hostel invoice ${invoiceNumber}`,
            text: invoiceMessage,
          },
        } : {}),
        ...(resident.phone ? { sms: { to: resident.phone, text: invoiceMessage } } : {}),
        deduplicationKey: `invoice-created:${invoice.id}`,
      });
    } else if (resident.email) {
      await this.notifications?.enqueueDelivery({
        kind: 'email',
        to: resident.email,
        subject: `New hostel invoice ${invoiceNumber}`,
        text: invoiceMessage,
      }, `invoice-created:${invoice.id}`);
    }
    if (dto.dueAt) {
      const reminderAt = new Date(dto.dueAt).getTime();
      const delay = Math.max(0, reminderAt - Date.now());
      if (this.notifications) {
        await this.notifications.schedulePaymentReminder({
          tenantId,
          branchId,
          residentId: resident.id,
          invoiceId: invoice.id,
          invoiceNumber,
          delay,
        });
      }
    }
    return this.presentInvoice(invoice);
  }

  async sendPendingRentReminder(tenantId: string, branchId: string, invoiceId: string) {
    if (!this.notifications) throw new Error('Notification delivery is unavailable');
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
        branchId,
        status: 'ISSUED',
        deletedAt: null,
        dueAt: { lte: new Date() },
      },
      include: {
        lines: { select: { lineAmountMinor: true } },
        payments: { where: { status: 'VERIFIED' }, select: { amountMinor: true } },
        refunds: { select: { amountMinor: true } },
      },
    });
    if (!invoice) return { sent: false };
    const total = invoice.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0);
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
    const refunded = invoice.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
    if (total - paid + refunded <= 0) return { sent: false };
    await this.notifications.notifyResident({
      tenantId,
      branchId,
      residentId: invoice.residentId,
      category: 'finance',
      title: 'Payment due',
      body: `Payment for invoice ${invoice.invoiceNumber} is now due. Please review your invoice and outstanding balance.`,
      emailSubject: `Payment due for invoice ${invoice.invoiceNumber}`,
      deduplicationKey: `pending-rent:${invoice.id}`,
    });
    return { sent: true };
  }

  async recordPayment(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const result = await this.prisma.$transaction(async (tx) => {
      const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM invoices
        WHERE id = ${invoiceId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid
          AND status = 'ISSUED'
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!invoiceRows.length) throw new NotFoundException('Issued invoice not found');
      const reference = dto.reference?.trim() || null;
      const proofNotes = dto.proofNotes?.trim() || null;
      const existing = await tx.payment.findFirst({
        where: {
          tenantId,
          branchId,
          invoiceId,
          recordedByUserId: actorUserId,
          submissionKey: dto.submissionKey,
        },
        select: {
          id: true,
          amountMinor: true,
          method: true,
          status: true,
          reference: true,
          proofNotes: true,
        },
      });
      if (existing) {
        if (
          existing.amountMinor !== dto.amountMinor ||
          existing.method !== dto.method ||
          existing.reference !== reference ||
          existing.proofNotes !== proofNotes
        ) {
          throw new ConflictException('Payment submission key was already used for different payment details');
        }
        return { payment: existing, created: false };
      }
      const payment = await tx.payment.create({
        data: {
          tenantId,
          branchId,
          invoiceId,
          amountMinor: dto.amountMinor,
          method: dto.method,
          reference,
          proofNotes,
          recordedByUserId: actorUserId,
          submissionKey: dto.submissionKey,
        },
      });
      return { payment, created: true };
    });
    if (result.created) {
      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'payment.record',
        module: 'payments',
        entityType: 'payment',
        entityId: result.payment.id,
        outcome: 'success',
        metadata: {
          amountMinor: result.payment.amountMinor,
          method: result.payment.method,
          status: result.payment.status,
        },
      });
    }
    return this.getInvoice(tenantId, branchId, invoiceId);
  }

  async reviewPayment(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    paymentId: string,
    dto: ReviewPaymentDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (!['VERIFIED', 'REJECTED'].includes(dto.status)) {
      throw new BadRequestException('Payment status must be VERIFIED or REJECTED');
    }
    if (dto.status === 'REJECTED' && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting a payment');
    }
    const existing = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, branchId },
      select: { id: true, invoiceId: true },
    });
    if (!existing) throw new NotFoundException('Payment not found');

    const result = await this.prisma.payment.updateMany({
      where: { id: paymentId, tenantId, branchId, status: 'PENDING' },
      data: {
        status: dto.status,
        rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null,
        verifiedByUserId: dto.status === 'VERIFIED' ? actorUserId : null,
        verifiedAt: dto.status === 'VERIFIED' ? new Date() : null,
      },
    });
    if (result.count !== 1) throw new ConflictException('Only pending payments can be reviewed');

    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: `payment.${dto.status.toLowerCase()}`,
      module: 'payments',
      entityType: 'payment',
      entityId: paymentId,
      outcome: 'success',
      metadata: { rejectionReason: dto.status === 'REJECTED' ? dto.rejectionReason!.trim() : null },
    });
    if (dto.status === 'VERIFIED') {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: existing.invoiceId, tenantId, branchId },
        select: {
          invoiceNumber: true,
          residentId: true,
          resident: { select: { userId: true, email: true, phone: true } },
        },
      });
      if (invoice && this.notifications) {
        const message = `Your payment for invoice ${invoice.invoiceNumber} has been confirmed.`;
        if (invoice.resident.userId) {
          await this.notifications.notifyUser({
            tenantId,
            branchId,
            userId: invoice.resident.userId,
            category: 'finance',
            title: 'Payment confirmed',
            body: message,
            ...(invoice.resident.email ? {
              email: {
                to: invoice.resident.email,
                subject: 'Hostel payment confirmed',
                text: message,
              },
            } : {}),
            ...(invoice.resident.phone ? {
              sms: { to: invoice.resident.phone, text: message },
            } : {}),
            deduplicationKey: `payment-verified:${paymentId}`,
          });
        } else if (invoice.resident.email) {
          await this.notifications.enqueueDelivery({
            kind: 'email',
            to: invoice.resident.email,
            subject: 'Hostel payment confirmed',
            text: message,
          }, `payment-verified:${paymentId}`);
        }
      }
    }
    return this.getInvoice(tenantId, branchId, existing.invoiceId);
  }

  async recordRefund(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    invoiceId: string,
    dto: RecordRefundDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const result = await this.prisma.$transaction(async (tx) => {
      const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM invoices
        WHERE id = ${invoiceId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid
          AND status = 'ISSUED'
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!invoiceRows.length) throw new NotFoundException('Issued invoice not found');
      const reference = dto.reference?.trim() || null;
      const notes = dto.notes?.trim() || null;
      const existing = await tx.refund.findFirst({
        where: {
          tenantId,
          branchId,
          invoiceId,
          recordedByUserId: actorUserId,
          submissionKey: dto.submissionKey,
        },
        select: { id: true, amountMinor: true, method: true, reference: true, notes: true },
      });
      if (existing) {
        if (
          existing.amountMinor !== dto.amountMinor ||
          existing.method !== dto.method ||
          existing.reference !== reference ||
          existing.notes !== notes
        ) {
          throw new ConflictException('Refund submission key was already used for different refund details');
        }
        return { refund: existing, created: false };
      }

      const [verifiedPayments, refunds] = await Promise.all([
        tx.payment.aggregate({
          where: { tenantId, branchId, invoiceId, status: 'VERIFIED' },
          _sum: { amountMinor: true },
        }),
        tx.refund.aggregate({
          where: { tenantId, branchId, invoiceId },
          _sum: { amountMinor: true },
        }),
      ]);
      const refundable = (verifiedPayments._sum.amountMinor ?? 0) - (refunds._sum.amountMinor ?? 0);
      if (dto.amountMinor > refundable) {
        throw new ConflictException('Refund exceeds verified payments remaining on this invoice');
      }
      const refund = await tx.refund.create({
        data: {
          tenantId,
          branchId,
          invoiceId,
          amountMinor: dto.amountMinor,
          method: dto.method,
          reference,
          notes,
          recordedByUserId: actorUserId,
          submissionKey: dto.submissionKey,
        },
      });
      return { refund, created: true };
    });

    if (result.created) {
      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'payment.refund',
        module: 'payments',
        entityType: 'refund',
        entityId: result.refund.id,
        outcome: 'success',
        metadata: { invoiceId, amountMinor: result.refund.amountMinor, method: result.refund.method },
      });
    }
    return this.getInvoice(tenantId, branchId, invoiceId);
  }

  private async ensureBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }

  private presentInvoice<
    T extends {
      status: InvoiceStatus;
      lines: Array<{ lineAmountMinor: number }>;
      payments: Array<{
        amountMinor: number;
        status: PaymentStatus;
        proofFileName?: string | null;
        proofData?: Uint8Array | null;
      }>;
      refunds: Array<{ amountMinor: number }>;
    },
  >(invoice: T) {
    const invoiceTotalMinor = invoice.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0);
    const verifiedPaymentsMinor = invoice.payments
      .filter((payment) => payment.status === 'VERIFIED')
      .reduce((sum, payment) => sum + payment.amountMinor, 0);
    const refundedMinor = invoice.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
    const netPaidMinor = verifiedPaymentsMinor - refundedMinor;
    const safePayments = invoice.payments.map(({ proofData: _proofData, ...payment }) => ({
      ...payment,
      proofAvailable: Boolean(payment.proofFileName),
    }));
    return {
      ...invoice,
      payments: safePayments,
      invoiceTotalMinor,
      verifiedPaymentsMinor,
      refundedMinor,
      balanceDueMinor: invoice.status === 'VOID' ? 0 : Math.max(invoiceTotalMinor - netPaidMinor, 0),
      creditMinor: invoice.status === 'VOID' ? 0 : Math.max(netPaidMinor - invoiceTotalMinor, 0),
    };
  }

  private validateProofFile(file: UploadedPaymentProof) {
    const signatures: Record<string, (buffer: Buffer) => boolean> = {
      'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
      'image/png': (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/webp': (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP',
      'application/pdf': (buffer) => buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-',
    };
    if (!signatures[file.mimetype]?.(file.buffer)) {
      throw new BadRequestException('Payment proof must be a valid JPEG, PNG, WebP image, or PDF');
    }
  }

  private safeProofFileName(fileName: string) {
    const safe = fileName.replace(/[^\w.-]/g, '_').slice(0, 120);
    return safe || 'payment-proof';
  }
}
