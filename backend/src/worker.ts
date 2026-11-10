import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { FinanceEnhancementsService } from './modules/finance/finance-enhancements.service';
import { FinanceService } from './modules/finance/finance.service';
import { PrismaService } from './common/prisma/prisma.service';
import { NOTIFICATION_QUEUE, NotificationsService } from './modules/notifications/notifications.service';

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('HmsWorker');
  const config = app.get(ConfigService);
  const notifications = app.get(NotificationsService);
  const finance = app.get(FinanceEnhancementsService);
  const financeService = app.get(FinanceService);
  const prisma = app.get(PrismaService);
  const workerAdminEmail = config.get<string>('app.platformWorkerAdminEmail', '');
  const connection = new IORedis(config.getOrThrow<string>('app.redisUrl'), {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(NOTIFICATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    },
  });
  if (workerAdminEmail) {
    await queue.add('platform-subscription-maintenance', {}, {
      jobId: 'platform-subscription-maintenance',
      repeat: { every: 24 * 60 * 60 * 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } else {
    logger.warn('Platform trial expiry and reminder jobs are disabled; configure PLATFORM_WORKER_ADMIN_EMAIL.');
  }
  const worker = new Worker(
    NOTIFICATION_QUEUE,
    async (job) => {
      if (job.name === 'deliver' && typeof job.data.encryptedPayload === 'string') {
        await notifications.deliver(job.data.encryptedPayload);
        return;
      }
      if (job.name === 'apply-late-fees'
        && typeof job.data.tenantId === 'string'
        && typeof job.data.branchId === 'string') {
        await prisma.runWithIndependentTenantContext(job.data.tenantId, () => (
          finance.applyLateFees(job.data.tenantId, job.data.branchId, null)
        ));
        return;
      }
      if (job.name === 'pending-rent-reminder'
        && typeof job.data.tenantId === 'string'
        && typeof job.data.branchId === 'string'
        && typeof job.data.invoiceId === 'string') {
        await prisma.runWithIndependentTenantContext(job.data.tenantId, () => (
          financeService.sendPendingRentReminder(
            job.data.tenantId,
            job.data.branchId,
            job.data.invoiceId,
          )
        ));
        return;
      }
      if (job.name === 'published-announcement'
        && typeof job.data.tenantId === 'string'
        && typeof job.data.branchId === 'string'
        && typeof job.data.noticeId === 'string') {
        await notifications.processPublishedAnnouncement(
          job.data.tenantId,
          job.data.branchId,
          job.data.noticeId,
        );
        return;
      }
      if (job.name === 'platform-subscription-maintenance' && workerAdminEmail) {
        await runPlatformSubscriptionMaintenance(prisma, notifications, workerAdminEmail);
        return;
      }
      throw new Error(`Unsupported notification job: ${job.name}`);
    },
    {
      connection,
      concurrency: config.getOrThrow<number>('app.workerConcurrency'),
    },
  );
  worker.on('completed', (job) => logger.log(`Notification job ${job.id} completed.`));
  worker.on('failed', (job, error) => {
    logger.error(`Notification job ${job?.id ?? 'unknown'} failed: ${error.message}`);
  });
  worker.on('error', (error) => logger.error(`Notification worker error: ${error.message}`));

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  logger.log(`Notification worker started with concurrency ${config.getOrThrow<number>('app.workerConcurrency')}.`);
}

async function runPlatformSubscriptionMaintenance(
  prisma: PrismaService,
  notifications: NotificationsService,
  workerAdminEmail: string,
) {
  const admin = await prisma.runWithPlatformLoginContext(workerAdminEmail, () =>
    prisma.platformAdmin.findUnique({
      where: { email: workerAdminEmail },
      select: { id: true, status: true },
    }),
  );
  if (!admin || admin.status !== 'ACTIVE') {
    throw new Error('PLATFORM_WORKER_ADMIN_EMAIL must identify an active platform administrator');
  }

  await prisma.runWithPlatformContext(admin.id, async () => {
    const now = new Date();
    const expired = await prisma.tenantSubscription.findMany({
      where: {
        OR: [
          { status: 'TRIAL', trialEndsAt: { lte: now } },
          { status: 'ACTIVE', periodEndsAt: { lte: now } },
        ],
      },
      select: { id: true, tenantId: true, status: true },
      take: 1000,
    });
    for (const subscription of expired) {
      const updated = await prisma.tenantSubscription.updateMany({
        where: { id: subscription.id, status: subscription.status },
        data: { status: 'EXPIRED' },
      });
      if (updated.count) {
        await prisma.subscriptionHistory.create({
          data: {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            platformAdminId: admin.id,
            event: 'subscription.expired',
            details: { previousStatus: subscription.status },
          },
        });
      }
    }

    const trialSettings = await prisma.trialSettings.findUnique({ where: { id: 1 } });
    if (!trialSettings?.notifyDaysBefore) return;
    const deadline = new Date(now.getTime() + trialSettings.notifyDaysBefore * 86_400_000);
    const expiring = await prisma.tenantSubscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { gt: now, lte: deadline },
      },
      include: {
        tenant: { select: { id: true, name: true } },
        plan: { select: { name: true } },
      },
      orderBy: { trialEndsAt: 'asc' },
      take: 1000,
    });
    for (const subscription of expiring) {
      await prisma.runWithTenantContext(subscription.tenantId, async () => {
        const owner = await prisma.user.findFirst({
          where: {
            tenantId: subscription.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
            userRoles: {
              some: {
                tenantId: subscription.tenantId,
                role: { name: 'Owner', isSystemRole: true, deletedAt: null },
              },
            },
          },
          select: { id: true, email: true },
        });
        if (!owner) return;
        const endsAt = subscription.trialEndsAt?.toLocaleDateString('en');
        const body = `The ${subscription.plan.name} trial for ${subscription.tenant.name} ends on ${endsAt}. Upgrade or renew to avoid losing access.`;
        await notifications.notifyUser({
          tenantId: subscription.tenantId,
          userId: owner.id,
          category: 'subscription',
          title: 'Hostel subscription trial ending soon',
          body,
          ...(owner.email ? {
            email: { to: owner.email, subject: 'Your HMS trial is ending soon', text: body },
          } : {}),
          deduplicationKey: `trial-expiring:${subscription.id}:${subscription.trialEndsAt?.toISOString().slice(0, 10)}`,
        });
      });
    }
  });
}

void bootstrapWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`HMS notification worker startup failed: ${message}`);
  process.exitCode = 1;
});
