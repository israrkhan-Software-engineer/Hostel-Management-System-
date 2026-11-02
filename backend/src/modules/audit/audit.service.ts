import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface AuditEntry {
  tenantId?: string;
  branchId?: string;
  actorUserId?: string;
  action: string;      // e.g. 'auth.login.success', 'payment.verify'
  module: string;      // e.g. 'auth', 'payments'
  entityType?: string;
  entityId?: string;
  outcome: 'success' | 'failure';
  /** NEVER include CNIC, health data, passwords, tokens or biometric data (DB §13) */
  beforeData?: Prisma.InputJsonObject;
  afterData?: Prisma.InputJsonObject;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Write an audit entry — append-only, no update/delete path.
   * Sensitive values (CNIC, health, passwords) must NEVER appear in any payload.
   * SRS V2 §4.11, §13.3 / DB §13.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: entry.tenantId ?? null,
          branchId: entry.branchId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          module: entry.module,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          outcome: entry.outcome,
          beforeData: entry.beforeData ?? Prisma.DbNull,
          afterData: entry.afterData ?? Prisma.DbNull,
          metadata: entry.metadata ?? Prisma.DbNull,
        },
      });
    } catch {
      // Audit failures must never crash the main request — log to stderr only
      console.error('[AuditService] Failed to write audit log:', entry.action);
    }
  }
}
