import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decryptField, encryptField } from '../../common/utils/field-encryption.util';

export const NOTIFICATION_QUEUE = 'notifications';

export interface DeliveryPayload {
  kind: 'email' | 'sms';
  to: string;
  subject?: string;
  text: string;
  html?: string;
}

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly queue: Queue;
  private readonly redis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.redis = new IORedis(this.config.getOrThrow<string>('app.redisUrl'), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(NOTIFICATION_QUEUE, {
      connection: this.redis,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    });
  }

  async list(tenantId: string, userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { tenantId, userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!updated.count) {
      const exists = await this.prisma.notification.findFirst({ where: { id, tenantId, userId } });
      if (!exists) throw new NotFoundException('Notification not found');
      return exists;
    }
    return this.prisma.notification.findFirstOrThrow({ where: { id, tenantId, userId } });
  }

  async markAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async preferences(tenantId: string, userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { tenantId, userId },
      orderBy: { category: 'asc' },
    });
  }

  async setPreference(
    tenantId: string,
    userId: string,
    category: string,
    values: { inApp?: boolean; email?: boolean; sms?: boolean },
  ) {
    if (!['admission', 'announcement', 'finance', 'gate_pass', 'leave', 'subscription'].includes(category)) {
      throw new BadRequestException('Unsupported notification category');
    }
    return this.prisma.notificationPreference.upsert({
      where: { tenantId_userId_category: { tenantId, userId, category } },
      create: {
        tenantId,
        userId,
        category,
        inApp: values.inApp ?? true,
        email: values.email ?? true,
        sms: values.sms ?? false,
      },
      update: values,
    });
  }

  async notifyUser(input: {
    tenantId: string;
    userId: string;
    branchId?: string;
    category: string;
    title: string;
    body: string;
    email?: { to: string; subject: string; text: string; html?: string };
    sms?: { to: string; text: string };
    deduplicationKey?: string;
  }) {
    const preferences = await this.prisma.notificationPreference.findUnique({
      where: {
        tenantId_userId_category: {
          tenantId: input.tenantId,
          userId: input.userId,
          category: input.category,
        },
      },
    });
    if (preferences?.inApp !== false) {
      const notificationData = {
        tenantId: input.tenantId,
        userId: input.userId,
        branchId: input.branchId,
        category: input.category,
        title: input.title,
        body: input.body,
        deduplicationKey: input.deduplicationKey,
      };
      if (input.deduplicationKey) {
        await this.prisma.notification.upsert({
          where: {
            tenantId_deduplicationKey: {
              tenantId: input.tenantId,
              deduplicationKey: input.deduplicationKey,
            },
          },
          create: notificationData,
          update: {},
        });
      } else {
        await this.prisma.notification.create({
          data: notificationData,
        });
      }
    }
    if (preferences?.email !== false && input.email) {
      await this.enqueueDelivery({
        kind: 'email',
        to: input.email.to,
        subject: input.email.subject,
        text: input.email.text,
        html: input.email.html,
      }, input.deduplicationKey);
    }
    if (preferences?.sms === true && input.sms) {
      await this.enqueueDelivery({ kind: 'sms', ...input.sms }, input.deduplicationKey
        ? `${input.deduplicationKey}:sms`
        : undefined);
    }
  }

  async notifyResident(input: {
    tenantId: string;
    branchId: string;
    residentId: string;
    category: string;
    title: string;
    body: string;
    emailSubject: string;
    deduplicationKey: string;
    emailDelay?: number;
  }) {
    const resident = await this.prisma.resident.findFirst({
      where: {
        id: input.residentId,
        tenantId: input.tenantId,
        branchId: input.branchId,
        deletedAt: null,
      },
      select: { userId: true, email: true, phone: true },
    });
    if (!resident) throw new NotFoundException('Resident not found for notification delivery');
    if (resident.userId) {
      await this.notifyUser({
        tenantId: input.tenantId,
        branchId: input.branchId,
        userId: resident.userId,
        category: input.category,
        title: input.title,
        body: input.body,
        ...(resident.email ? {
          email: {
            to: resident.email,
            subject: input.emailSubject,
            text: input.body,
          },
        } : {}),
        ...(resident.phone ? { sms: { to: resident.phone, text: input.body } } : {}),
        deduplicationKey: input.deduplicationKey,
      });
    } else if (resident.email) {
      await this.enqueueDelivery({
        kind: 'email',
        to: resident.email,
        subject: input.emailSubject,
        text: input.body,
      }, input.deduplicationKey, input.emailDelay);
    }
  }

  async notifyBranchResidents(input: {
    tenantId: string;
    branchId: string;
    category: string;
    title: string;
    body: string;
    deduplicationKey: string;
  }) {
    let cursor: string | null = null;
    while (cursor !== null) {
      const residents = await this.prisma.runWithIndependentTenantContext(
        input.tenantId,
        () => this.prisma.resident.findMany({
          where: {
            tenantId: input.tenantId,
            branchId: input.branchId,
            status: 'ACTIVE',
            deletedAt: null,
            userId: { not: null },
          },
          select: { id: true, userId: true, email: true, phone: true },
          orderBy: { id: 'asc' },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      );
      for (const resident of residents) {
        const userId = resident.userId;
        if (!userId) continue;
        await this.prisma.runWithIndependentTenantContext(input.tenantId, () => (
          this.notifyUser({
            tenantId: input.tenantId,
            branchId: input.branchId,
            userId,
            category: input.category,
            title: input.title,
            body: input.body,
            ...(resident.email ? {
              email: {
                to: resident.email,
                subject: input.title,
                text: input.body,
              },
            } : {}),
            ...(resident.phone ? { sms: { to: resident.phone, text: input.body } } : {}),
            deduplicationKey: `${input.deduplicationKey}:${resident.id}`,
          })
        ));
      }
      if (residents.length < 500) break;
      cursor = residents[residents.length - 1].id;
    }
  }

  async schedulePaymentReminder(input: {
    tenantId: string;
    branchId: string;
    residentId: string;
    invoiceId: string;
    invoiceNumber: string;
    delay: number;
  }) {
    await this.queue.add('pending-rent-reminder', input, {
      jobId: `pending-rent-${input.invoiceId}`,
      delay: Math.max(input.delay, 5_000),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
  }

  async enqueueDelivery(payload: DeliveryPayload, idempotencyKey?: string, delay = 0) {
    const encryptedPayload = encryptField(JSON.stringify(payload), this.config.getOrThrow('app.fieldEncryptionKey'));
    const jobId = idempotencyKey
      ? createHash('sha256').update(idempotencyKey).digest('hex')
      : randomUUID();
    await this.queue.add('deliver', { encryptedPayload }, {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      delay: Math.max(delay, 5_000),
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
  }

  async scheduleLateFeeProcessing(tenantId: string, branchId: string) {
    await this.queue.add('apply-late-fees', { tenantId, branchId }, {
      jobId: `late-fees-${tenantId}-${branchId}`,
      repeat: { pattern: '0 2 * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    });
  }

  async schedulePublishedAnnouncement(tenantId: string, branchId: string, noticeId: string) {
    await this.queue.add('published-announcement', { tenantId, branchId, noticeId }, {
      jobId: `published-announcement-${noticeId}`,
      delay: 1_000,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
  }

  async processPublishedAnnouncement(tenantId: string, branchId: string, noticeId: string) {
    const notice = await this.prisma.runWithIndependentTenantContext(tenantId, () => (
      this.prisma.notice.findFirst({
        where: { id: noticeId, tenantId, branchId, status: 'PUBLISHED' },
        select: { title: true, body: true },
      })
    ));
    if (!notice) throw new Error('Published announcement is not available for delivery.');
    await this.notifyBranchResidents({
      tenantId,
      branchId,
      category: 'announcement',
      title: notice.title,
      body: notice.body,
      deduplicationKey: `notice-published:${noticeId}`,
    });
  }

  async deliver(encryptedPayload: string) {
    const payload = JSON.parse(
      decryptField(encryptedPayload, this.config.getOrThrow('app.fieldEncryptionKey')),
    ) as DeliveryPayload;

    if (payload.kind === 'email') {
      const provider = this.config.get<string>('app.emailProvider');
      if (provider !== 'resend') {
        throw new Error('Email delivery requires NOTIFICATION_EMAIL_PROVIDER=resend.');
      }
      const apiKey = this.config.getOrThrow<string>('app.emailApiKey');
      const from = this.config.getOrThrow<string>('app.emailFrom');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          ...(payload.html ? { html: payload.html } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
      return;
    }

    const provider = this.config.get<string>('app.smsProvider');
    if (provider !== 'twilio') {
      throw new Error('SMS delivery requires NOTIFICATION_SMS_PROVIDER=twilio.');
    }
    const accountSid = this.config.getOrThrow<string>('app.twilioAccountSid');
    const authToken = this.config.getOrThrow<string>('app.twilioAuthToken');
    const from = this.config.getOrThrow<string>('app.twilioFrom');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: payload.to, From: from, Body: payload.text }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`SMS provider returned HTTP ${response.status}.`);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.redis.quit();
  }
}
