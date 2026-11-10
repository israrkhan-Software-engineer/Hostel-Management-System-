import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DepositTransactionType, DiscountType, LateFeeType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateInvoiceDto } from './finance.dto';
import {
  AssignFeeDto,
  CreateDepositTransactionDto,
  CreateFeeStructureDto,
  CreateLateFeeSettingDto,
  CreateStudentDiscountDto,
} from './finance-enhancements.dto';
import { FinanceService } from './finance.service';

const MAX_AMOUNT_MINOR = 2_147_483_647;

@Injectable()
export class FinanceEnhancementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly finance: FinanceService,
  ) {}

  async listFeeStructures(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.feeStructure.findMany({
      where: { tenantId, branchId },
      include: { assignments: { orderBy: { startsAt: 'desc' }, take: 100 } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createFeeStructure(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateFeeStructureDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const feeStructure = await this.prisma.feeStructure.create({
      data: {
        tenantId,
        branchId,
        name: dto.name.trim(),
        category: dto.category?.trim() || null,
        interval: dto.interval,
        amountMinor: dto.amountMinor,
        currency: tenant.currency,
        createdByUserId: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'fee_structure.create',
      module: 'invoices',
      entityType: 'fee_structure',
      entityId: feeStructure.id,
      outcome: 'success',
      metadata: { amountMinor: feeStructure.amountMinor, interval: feeStructure.interval },
    });
    return feeStructure;
  }

  async deactivateFeeStructure(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    feeStructureId: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const result = await this.prisma.feeStructure.updateMany({
      where: { id: feeStructureId, tenantId, branchId, isActive: true },
      data: { isActive: false },
    });
    if (!result.count) throw new NotFoundException('Active fee structure not found');
    const feeStructure = await this.prisma.feeStructure.findFirstOrThrow({
      where: { id: feeStructureId, tenantId, branchId },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'fee_structure.deactivate',
      module: 'invoices',
      entityType: 'fee_structure',
      entityId: feeStructure.id,
      outcome: 'success',
    });
    return feeStructure;
  }

  async assignFee(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    feeStructureId: string,
    dto: AssignFeeDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const [structure, resident] = await Promise.all([
      this.prisma.feeStructure.findFirst({
        where: { id: feeStructureId, tenantId, branchId, isActive: true },
      }),
      this.prisma.resident.findFirst({
        where: { id: dto.residentId, tenantId, branchId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!structure) throw new NotFoundException('Active fee structure not found');
    if (!resident) throw new NotFoundException('Resident not found');
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw new BadRequestException('Fee end date precedes its start date');

    const assignment = await this.prisma.feeAssignment.create({
      data: {
        tenantId,
        branchId,
        residentId: resident.id,
        feeStructureId: structure.id,
        amountMinor: structure.amountMinor,
        interval: structure.interval,
        startsAt,
        endsAt,
        assignedByUserId: actorUserId,
      },
      include: { feeStructure: true },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: actorUserId ?? undefined,
      action: 'fee_structure.assign',
      module: 'invoices',
      entityType: 'fee_assignment',
      entityId: assignment.id,
      outcome: 'success',
      metadata: { residentId: resident.id, amountMinor: assignment.amountMinor },
    });
    return assignment;
  }

  async listFeeHistory(tenantId: string, branchId: string, residentId: string) {
    await this.ensureResident(tenantId, branchId, residentId);
    return this.prisma.feeAssignment.findMany({
      where: { tenantId, branchId, residentId },
      include: { feeStructure: true },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async createInvoiceFromFee(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    assignmentId: string,
    dueAt?: string,
  ) {
    const assignment = await this.prisma.feeAssignment.findFirst({
      where: { id: assignmentId, tenantId, branchId },
      include: { feeStructure: true, resident: { select: { id: true } } },
    });
    if (!assignment) throw new NotFoundException('Fee assignment not found');
    const today = new Date();
    const discounts = await this.prisma.studentDiscount.findMany({
      where: {
        tenantId,
        branchId,
        residentId: assignment.residentId,
        approvedAt: { not: null },
        startsAt: { lte: today },
        OR: [{ endsAt: null }, { endsAt: { gte: today } }],
      },
    });
    let discountMinor = 0;
    for (const discount of discounts) {
      discountMinor += discount.type === DiscountType.PERCENTAGE
        ? Math.floor(assignment.amountMinor * discount.value / 10_000)
        : discount.value;
    }
    discountMinor = Math.min(discountMinor, assignment.amountMinor - 1);
    const invoiceDto: CreateInvoiceDto = {
      residentId: assignment.residentId,
      ...(dueAt ? { dueAt } : {}),
      notes: discountMinor
        ? `Approved student discount: ${discountMinor} minor units`
        : undefined,
      lines: [{
        description: `${assignment.feeStructure.name}${discountMinor ? ' (approved discount applied)' : ''}`,
        quantity: 1,
        unitAmountMinor: assignment.amountMinor - discountMinor,
      }],
    };
    return this.finance.createInvoice(tenantId, branchId, actorUserId, invoiceDto, assignment.id);
  }

  async createLateFeeSetting(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateLateFeeSettingDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (dto.feeType === LateFeeType.PERCENTAGE && dto.amount > 10_000) {
      throw new BadRequestException('Percentage late fees use basis points and cannot exceed 10000');
    }
    const setting = await this.prisma.lateFeeSetting.create({
      data: { tenantId, branchId, ...dto, createdByUserId: actorUserId },
    });
    await this.notifications.scheduleLateFeeProcessing(tenantId, branchId);
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'late_fee_setting.create',
      module: 'invoices',
      entityType: 'late_fee_setting',
      entityId: setting.id,
      outcome: 'success',
      metadata: { feeType: setting.feeType, amount: setting.amount, daysAfterDue: setting.daysAfterDue },
    });
    return setting;
  }

  async deactivateLateFeeSetting(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    settingId: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const updated = await this.prisma.lateFeeSetting.updateMany({
      where: { id: settingId, tenantId, branchId, isActive: true },
      data: { isActive: false },
    });
    if (!updated.count) throw new NotFoundException('Active late fee rule not found');
    const setting = await this.prisma.lateFeeSetting.findFirstOrThrow({
      where: { id: settingId, tenantId, branchId },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'late_fee_setting.deactivate',
      module: 'invoices',
      entityType: 'late_fee_setting',
      entityId: setting.id,
      outcome: 'success',
    });
    return setting;
  }

  async listLateFeeSettings(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.lateFeeSetting.findMany({
      where: { tenantId, branchId },
      orderBy: [{ isActive: 'desc' }, { daysAfterDue: 'asc' }],
    });
  }

  async applyLateFees(tenantId: string, branchId: string, actorUserId: string | null) {
    await this.ensureBranch(tenantId, branchId);
    const today = new Date();
    const settings = await this.prisma.runWithIndependentTenantContext(tenantId, () => (
      this.prisma.lateFeeSetting.findMany({
        where: { tenantId, branchId, isActive: true },
        orderBy: { daysAfterDue: 'asc' },
      })
    ));
    let applied = 0;
    let cursor: string | null = null;
    while (cursor !== null) {
      const invoices = await this.prisma.runWithIndependentTenantContext(tenantId, () => (
        this.prisma.invoice.findMany({
          where: {
            tenantId,
            branchId,
            status: 'ISSUED',
            deletedAt: null,
            dueAt: { lt: today },
          },
          select: { id: true, dueAt: true },
          orderBy: { id: 'asc' },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
      ));
      for (const invoice of invoices) {
        if (!invoice.dueAt) continue;
        const daysOverdue = Math.floor((today.getTime() - invoice.dueAt.getTime()) / 86_400_000);
        for (const setting of settings.filter((item) => daysOverdue >= item.daysAfterDue)) {
          const result = await this.prisma.runWithIndependentTenantContext(tenantId, async () => {
            const locked = await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM invoices
              WHERE id = ${invoice.id}::uuid AND tenant_id = ${tenantId}::uuid
                AND branch_id = ${branchId}::uuid AND status = 'ISSUED' AND deleted_at IS NULL
              FOR UPDATE
            `;
            if (!locked.length) return false;
            const exists = await this.prisma.lateFeeHistory.findUnique({
              where: {
                tenantId_branchId_invoiceId_settingId: {
                  tenantId,
                  branchId,
                  invoiceId: invoice.id,
                  settingId: setting.id,
                },
              },
            });
            if (exists) return false;
            const [lines, payments, refunds] = await Promise.all([
              this.prisma.invoiceLine.aggregate({
                where: { tenantId, branchId, invoiceId: invoice.id },
                _sum: { lineAmountMinor: true },
              }),
              this.prisma.payment.aggregate({
                where: { tenantId, branchId, invoiceId: invoice.id, status: 'VERIFIED' },
                _sum: { amountMinor: true },
              }),
              this.prisma.refund.aggregate({
                where: { tenantId, branchId, invoiceId: invoice.id },
                _sum: { amountMinor: true },
              }),
            ]);
            const outstanding = Math.max(
              (lines._sum.lineAmountMinor ?? 0)
                - (payments._sum.amountMinor ?? 0)
                + (refunds._sum.amountMinor ?? 0),
              0,
            );
            if (!outstanding) return false;
            const amountMinor = setting.feeType === LateFeeType.FIXED
              ? setting.amount
              : Math.floor(outstanding * setting.amount / 10_000);
            if (!amountMinor || amountMinor > MAX_AMOUNT_MINOR || outstanding + amountMinor > MAX_AMOUNT_MINOR) {
              throw new ConflictException('Late fee exceeds the supported invoice amount');
            }
            await this.prisma.lateFeeHistory.create({
              data: {
                tenantId,
                branchId,
                invoiceId: invoice.id,
                settingId: setting.id,
                amountMinor,
                recordedByUserId: actorUserId ?? setting.createdByUserId,
              },
            });
            await this.prisma.invoiceLine.create({
              data: {
                tenantId,
                branchId,
                invoiceId: invoice.id,
                description: `Late fee (${setting.daysAfterDue} days after due date)`,
                quantity: 1,
                unitAmountMinor: amountMinor,
                lineAmountMinor: amountMinor,
              },
            });
            return true;
          });
          if (result) applied += 1;
        }
      }
      if (invoices.length < 500) break;
      cursor = invoices[invoices.length - 1].id;
    }
    if (applied) {
      await this.audit.logDurably({
        tenantId,
        branchId,
        actorUserId: actorUserId ?? undefined,
        action: 'invoice.late_fee.apply',
        module: 'invoices',
        outcome: 'success',
        metadata: { count: applied },
      });
    }
    return { applied };
  }

  async listLateFeeHistory(tenantId: string, branchId: string, invoiceId?: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.lateFeeHistory.findMany({
      where: { tenantId, branchId, ...(invoiceId ? { invoiceId } : {}) },
      orderBy: { appliedAt: 'desc' },
      take: 200,
    });
  }

  async createDiscount(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateStudentDiscountDto,
  ) {
    await this.ensureResident(tenantId, branchId, dto.residentId);
    if (dto.type === DiscountType.PERCENTAGE && dto.value > 10_000) {
      throw new BadRequestException('Percentage discounts use basis points and cannot exceed 10000');
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw new BadRequestException('Discount end date precedes its start date');
    const discount = await this.prisma.studentDiscount.create({
      data: {
        tenantId,
        branchId,
        residentId: dto.residentId,
        type: dto.type,
        value: dto.value,
        reason: dto.reason.trim(),
        startsAt,
        endsAt,
        createdByUserId: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'student_discount.create',
      module: 'invoices',
      entityType: 'student_discount',
      entityId: discount.id,
      outcome: 'success',
      metadata: { type: discount.type, value: discount.value },
    });
    return discount;
  }

  async listDiscounts(tenantId: string, branchId: string, residentId?: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.studentDiscount.findMany({
      where: { tenantId, branchId, ...(residentId ? { residentId } : {}) },
      include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async approveDiscount(tenantId: string, branchId: string, actorUserId: string, discountId: string) {
    await this.ensureBranch(tenantId, branchId);
    const updated = await this.prisma.studentDiscount.updateMany({
      where: { id: discountId, tenantId, branchId, approvedAt: null },
      data: { approvedAt: new Date(), approvedByUserId: actorUserId },
    });
    if (!updated.count) {
      const existing = await this.prisma.studentDiscount.findFirst({
        where: { id: discountId, tenantId, branchId },
      });
      if (!existing) throw new NotFoundException('Discount not found');
      throw new ConflictException('Discount has already been approved');
    }
    const discount = await this.prisma.studentDiscount.findFirstOrThrow({
      where: { id: discountId, tenantId, branchId },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'student_discount.approve',
      module: 'invoices',
      entityType: 'student_discount',
      entityId: discount.id,
      outcome: 'success',
    });
    return discount;
  }

  async createDepositTransaction(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateDepositTransactionDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (dto.type !== DepositTransactionType.ADJUSTMENT && dto.amountMinor <= 0) {
      throw new BadRequestException('Deposits and refunds must be positive amounts');
    }
    if (dto.type === DepositTransactionType.ADJUSTMENT && dto.amountMinor === 0) {
      throw new BadRequestException('Deposit adjustments cannot be zero');
    }
    const existing = await this.prisma.securityDepositTransaction.findUnique({
      where: {
        tenantId_branchId_residentId_submissionKey: {
          tenantId,
          branchId,
          residentId: dto.residentId,
          submissionKey: dto.submissionKey,
        },
      },
    });
    if (existing) {
      if (existing.type !== dto.type || existing.amountMinor !== dto.amountMinor
        || existing.reference !== (dto.reference?.trim() || null)
        || existing.notes !== (dto.notes?.trim() || null)) {
        throw new ConflictException('Submission key was already used for a different deposit transaction');
      }
      return existing;
    }
    const transaction = await this.prisma.$transaction(async (tx) => {
      const residentRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM residents
        WHERE id = ${dto.residentId}::uuid AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!residentRows.length) throw new NotFoundException('Resident not found');
      const existingRow = await tx.securityDepositTransaction.findUnique({
        where: {
          tenantId_branchId_residentId_submissionKey: {
            tenantId,
            branchId,
            residentId: dto.residentId,
            submissionKey: dto.submissionKey,
          },
        },
      });
      if (existingRow) {
        if (existingRow.type !== dto.type || existingRow.amountMinor !== dto.amountMinor
          || existingRow.reference !== (dto.reference?.trim() || null)
          || existingRow.notes !== (dto.notes?.trim() || null)) {
          throw new ConflictException('Submission key was already used for a different deposit transaction');
        }
        return existingRow;
      }
      const rows = await tx.securityDepositTransaction.findMany({
        where: { tenantId, branchId, residentId: dto.residentId },
        select: { type: true, amountMinor: true },
      });
      const balanceMinor = rows.reduce((balance, row) => {
        if (row.type === DepositTransactionType.REFUND) return balance - row.amountMinor;
        return balance + row.amountMinor;
      }, 0);
      if (dto.type === DepositTransactionType.REFUND && dto.amountMinor > balanceMinor) {
        throw new ConflictException('Refund exceeds the available security deposit balance');
      }
      if (dto.type === DepositTransactionType.ADJUSTMENT && balanceMinor + dto.amountMinor < 0) {
        throw new ConflictException('Adjustment cannot reduce the deposit balance below zero');
      }
      return tx.securityDepositTransaction.create({
        data: {
          tenantId,
          branchId,
          residentId: dto.residentId,
          type: dto.type,
          amountMinor: dto.amountMinor,
          submissionKey: dto.submissionKey,
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || null,
          recordedByUserId: actorUserId,
        },
      });
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: `security_deposit.${transaction.type.toLowerCase()}`,
      module: 'payments',
      entityType: 'security_deposit_transaction',
      entityId: transaction.id,
      outcome: 'success',
      metadata: { residentId: dto.residentId, amountMinor: transaction.amountMinor },
    });
    return transaction;
  }

  async getDepositBalance(tenantId: string, branchId: string, residentId: string) {
    await this.ensureResident(tenantId, branchId, residentId);
    const transactions = await this.prisma.securityDepositTransaction.findMany({
      where: { tenantId, branchId, residentId },
      orderBy: { createdAt: 'desc' },
    });
    const balanceMinor = transactions.reduce((balance, transaction) => (
      transaction.type === DepositTransactionType.REFUND
        ? balance - transaction.amountMinor
        : balance + transaction.amountMinor
    ), 0);
    return { residentId, balanceMinor, transactions };
  }

  async getMyDepositBalance(tenantId: string, branchId: string, userId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { tenantId, branchId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Student account is not linked to a resident record');
    return this.getDepositBalance(tenantId, branchId, resident.id);
  }

  private async ensureResident(tenantId: string, branchId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');
    return resident;
  }

  private async ensureBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }
}
