import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingInterval, PlatformInvoiceStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  AssignSubscriptionDto,
  RecordPlatformPaymentDto,
  SubscriptionQueryDto,
  UpdateTrialSettingsDto,
  UpsertSubscriptionPlanDto,
} from './saas.dto';

const planSelect = {
  id: true,
  name: true,
  description: true,
  monthlyPriceMinor: true,
  yearlyPriceMinor: true,
  currency: true,
  userLimit: true,
  branchLimit: true,
  features: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class SaasService {
  constructor(private readonly prisma: PrismaService) {}

  listPlans(adminId: string) {
    return this.prisma.runWithPlatformContext(adminId, () =>
      this.prisma.subscriptionPlan.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: planSelect,
      }),
    );
  }

  async savePlan(adminId: string, dto: UpsertSubscriptionPlanDto, planId?: string) {
    this.validateFeatures(dto.features);
    return this.prisma.runWithPlatformContext(adminId, async () => {
      if (planId && !Object.keys(dto).length) {
        throw new BadRequestException('Provide at least one plan field to update');
      }
      if (dto.name !== undefined && !dto.name.trim()) {
        throw new BadRequestException('Plan name cannot be empty');
      }
      if (planId && !await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } })) {
        throw new NotFoundException('Subscription plan not found');
      }
      try {
        const plan = planId
          ? await this.prisma.subscriptionPlan.update({
              where: { id: planId },
              data: {
                ...dto,
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
                ...(dto.features !== undefined
                  ? { features: dto.features as Prisma.InputJsonObject }
                  : {}),
              },
              select: planSelect,
            })
          : await this.prisma.subscriptionPlan.create({
              data: {
                name: dto.name?.trim() ?? '',
                description: dto.description,
                monthlyPriceMinor: dto.monthlyPriceMinor ?? 0,
                yearlyPriceMinor: dto.yearlyPriceMinor ?? 0,
                currency: dto.currency?.toUpperCase() ?? 'PKR',
                userLimit: dto.userLimit ?? 10,
                branchLimit: dto.branchLimit ?? 1,
                features: (dto.features ?? {}) as Prisma.InputJsonObject,
                isActive: dto.isActive ?? true,
              },
              select: planSelect,
            });
        await this.audit(adminId, planId ? 'subscription_plan.update' : 'subscription_plan.create', {
          planId: plan.id,
          name: plan.name,
          updatedFields: Object.keys(dto),
        });
        return plan;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('A subscription plan with this name already exists');
        }
        throw error;
      }
    });
  }

  async getTrialSettings(adminId: string) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const settings = await this.prisma.trialSettings.findUnique({
        where: { id: 1 },
        include: { trialPlan: true },
      });
      if (!settings) throw new NotFoundException('Trial settings have not been initialized');
      return settings;
    });
  }

  async updateTrialSettings(adminId: string, dto: UpdateTrialSettingsDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      if (!Object.keys(dto).length) throw new BadRequestException('Provide a trial setting to update');
      if (dto.trialPlanId) {
        const plan = await this.prisma.subscriptionPlan.findFirst({
          where: { id: dto.trialPlanId, isActive: true },
          select: { id: true },
        });
        if (!plan) throw new BadRequestException('Trial plan must be active');
      }
      const settings = await this.prisma.trialSettings.update({
        where: { id: 1 },
        data: dto,
        include: { trialPlan: true },
      });
      await this.audit(adminId, 'trial_settings.update', {
        durationDays: settings.durationDays,
        trialPlanId: settings.trialPlanId,
        notifyDaysBefore: settings.notifyDaysBefore,
      });
      return settings;
    });
  }

  async assignSubscription(adminId: string, tenantId: string, dto: AssignSubscriptionDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      await this.requireTenant(tenantId);
      const plan = await this.prisma.subscriptionPlan.findFirst({
        where: { id: dto.planId, isActive: true },
      });
      if (!plan) throw new BadRequestException('Select an active subscription plan');

      const now = new Date();
      const trial = dto.status === SubscriptionStatus.TRIAL;
      const trialSettings = trial
        ? await this.prisma.trialSettings.findUnique({ where: { id: 1 } })
        : null;
      const periodEnd = trial
        ? new Date(now.getTime() + (trialSettings?.durationDays ?? 14) * 86_400_000)
        : addInterval(now, dto.billingInterval);
      const price = dto.billingInterval === BillingInterval.YEARLY
        ? plan.yearlyPriceMinor
        : plan.monthlyPriceMinor;

      try {
        const result = await this.prisma.$transaction(async (tx) => {
        const current = await tx.tenantSubscription.findFirst({
          where: { tenantId, status: { in: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (current) {
          await tx.tenantSubscription.update({
            where: { id: current.id },
            data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
          });
        }

        const subscription = await tx.tenantSubscription.create({
          data: {
            tenantId,
            planId: plan.id,
            status: dto.status ?? SubscriptionStatus.ACTIVE,
            billingInterval: dto.billingInterval,
            trialStartedAt: trial ? now : null,
            trialEndsAt: trial ? periodEnd : null,
            periodStartedAt: now,
            periodEndsAt: periodEnd,
          },
          include: { plan: { select: planSelect } },
        });

        if (!trial && price > 0) {
          await tx.platformInvoice.create({
            data: {
              tenantId,
              subscriptionId: subscription.id,
              invoiceNumber: `HMS-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
              description: `${plan.name} ${dto.billingInterval.toLowerCase()} subscription`,
              amountMinor: price,
              currency: plan.currency,
              dueAt: now,
            },
          });
        }
        await tx.subscriptionHistory.create({
          data: {
            tenantId,
            subscriptionId: subscription.id,
            platformAdminId: adminId,
            event: trial ? 'trial.started' : 'subscription.assigned',
            details: {
              planId: plan.id,
              planName: plan.name,
              billingInterval: dto.billingInterval,
              status: subscription.status,
              amountMinor: trial ? 0 : price,
            },
          },
        });
        return subscription;
        });
        return result;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Tenant already has a current subscription; reload and retry');
        }
        throw error;
      }
    });
  }

  async changeSubscriptionStatus(
    adminId: string,
    tenantId: string,
    status: SubscriptionStatus,
  ) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      await this.requireTenant(tenantId);
      const current = await this.prisma.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!current) throw new NotFoundException('Tenant has no subscription');
      if (current.status === SubscriptionStatus.EXPIRED || current.status === SubscriptionStatus.CANCELLED) {
        throw new ConflictException('Expired or cancelled subscriptions require a new plan assignment');
      }
      if (
        status === SubscriptionStatus.ACTIVE
        && current.status !== SubscriptionStatus.SUSPENDED
        && current.status !== SubscriptionStatus.ACTIVE
      ) {
        throw new ConflictException('Only a suspended subscription can be reactivated');
      }
      const now = new Date();
      if (
        status === SubscriptionStatus.ACTIVE
        && current.status === SubscriptionStatus.SUSPENDED
        && current.periodEndsAt <= now
      ) {
        throw new ConflictException('The subscription period has ended; assign a new subscription to reactivate access');
      }
      const updated = await this.prisma.tenantSubscription.update({
        where: { id: current.id },
        data: {
          status,
          suspendedAt: status === SubscriptionStatus.SUSPENDED ? now : null,
          cancelledAt: status === SubscriptionStatus.CANCELLED ? now : null,
        },
        include: { plan: { select: planSelect } },
      });
      await this.prisma.subscriptionHistory.create({
        data: {
          tenantId,
          subscriptionId: current.id,
          platformAdminId: adminId,
          event: `subscription.${status.toLowerCase()}`,
          details: { previousStatus: current.status, status },
        },
      });
      return updated;
    });
  }

  async getTenantSubscription(adminId: string, tenantId: string) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      await this.requireTenant(tenantId);
      const subscription = await this.prisma.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          plan: { select: planSelect },
          invoices: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { payments: { orderBy: { receivedAt: 'desc' } } },
          },
          history: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
      return subscription;
    });
  }

  async listInvoices(adminId: string, filter: SubscriptionQueryDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const where = {
        ...(filter.status ? { status: filter.status } : {}),
      };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.platformInvoice.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
          include: {
            tenant: { select: { id: true, name: true, slug: true } },
            payments: { orderBy: { receivedAt: 'desc' } },
          },
        }),
        this.prisma.platformInvoice.count({ where }),
      ]);
      return this.paginated(items, total, filter);
    });
  }

  async recordPayment(adminId: string, invoiceId: string, dto: RecordPlatformPaymentDto) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.platformInvoice.findUnique({ where: { id: invoiceId } });
        if (!invoice) throw new NotFoundException('Subscription invoice not found');
        if (invoice.status === PlatformInvoiceStatus.VOID) {
          throw new ConflictException('Voided subscription invoices cannot be paid');
        }
        if (dto.amountMinor !== invoice.amountMinor) {
          throw new BadRequestException('Payment amount must exactly match the invoice balance');
        }
        const existing = await tx.platformPayment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          if (existing.invoiceId !== invoiceId || existing.amountMinor !== dto.amountMinor) {
            throw new ConflictException('Idempotency key was already used for a different payment');
          }
          return existing;
        }
        if (invoice.status === PlatformInvoiceStatus.PAID) {
          throw new ConflictException('This subscription invoice is already paid');
        }
        const payment = await tx.platformPayment.create({
          data: {
            tenantId: invoice.tenantId,
            invoiceId,
            amountMinor: dto.amountMinor,
            method: dto.method,
            idempotencyKey: dto.idempotencyKey,
            recordedBy: adminId,
            reference: dto.reference,
            notes: dto.notes,
          },
        });
        await tx.platformInvoice.update({
          where: { id: invoiceId },
          data: { status: PlatformInvoiceStatus.PAID, paidAt: new Date() },
        });
        return payment;
        });
        return result;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.prisma.platformPayment.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          });
          if (existing?.invoiceId === invoiceId && existing.amountMinor === dto.amountMinor) return existing;
          throw new ConflictException('Payment key or invoice was already processed');
        }
        throw error;
      }
    });
  }

  async report(adminId: string) {
    return this.prisma.runWithPlatformContext(adminId, async () => {
      const [plans, subscriptions, invoices, payments, trialsExpiring] = await Promise.all([
        this.prisma.subscriptionPlan.findMany({
          select: { id: true, name: true, isActive: true, userLimit: true, branchLimit: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.tenantSubscription.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.platformInvoice.groupBy({
          by: ['status', 'currency'],
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        this.prisma.platformPayment.groupBy({
          by: ['tenantId'],
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        this.prisma.tenantSubscription.findMany({
          where: {
            status: SubscriptionStatus.TRIAL,
            trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) },
          },
          orderBy: { trialEndsAt: 'asc' },
          take: 100,
          include: { tenant: { select: { id: true, name: true, slug: true } }, plan: { select: { name: true } } },
        }),
      ]);
      return { plans, subscriptions, invoices, payments, trialsExpiring };
    });
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private audit(adminId: string, action: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.platformAdminAuditLog.create({
      data: { platformAdminId: adminId, action, metadata },
    });
  }

  private validateFeatures(features?: Record<string, boolean>) {
    if (!features) return;
    for (const [feature, enabled] of Object.entries(features)) {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(feature) || typeof enabled !== 'boolean') {
        throw new BadRequestException('Features must map valid feature names to boolean values');
      }
    }
  }

  private paginated<T>(items: T[], total: number, filter: SubscriptionQueryDto) {
    return {
      items,
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      pageCount: Math.ceil(total / filter.pageSize),
    };
  }
}

function addInterval(date: Date, interval: BillingInterval): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  if (interval === BillingInterval.YEARLY) result.setUTCFullYear(result.getUTCFullYear() + 1);
  else result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
