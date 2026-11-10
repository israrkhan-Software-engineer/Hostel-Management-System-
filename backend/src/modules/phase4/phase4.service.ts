import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateComplaintDto,
  CreateNoticeDto,
  SaveMessMenuDto,
  UpdateComplaintDto,
  UpdateNoticeDto,
} from './phase4.dto';
import { hasPrismaErrorCode } from '../../common/utils/prisma-error.util';

const complaintSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  submittedByUserId: true,
  assignedToUserId: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  submittedBy: { select: { id: true, email: true, phone: true } },
  assignedTo: { select: { id: true, email: true, phone: true } },
} satisfies Prisma.ComplaintSelect;

@Injectable()
export class Phase4Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async listMessMenus(tenantId: string, branchId: string, weekStart?: string) {
    await this.ensureBranch(tenantId, branchId);
    if (weekStart) {
      const weekStartDate = this.parseDateOnly(weekStart, 'weekStart');
      const menu = await this.prisma.messMenu.findFirst({
        where: { tenantId, branchId, weekStart: weekStartDate },
        include: { entries: { orderBy: [{ dayOfWeek: 'asc' }, { meal: 'asc' }] } },
      });
      return menu ?? { id: null, weekStart: weekStartDate, entries: [] };
    }

    return this.prisma.messMenu.findMany({
      where: { tenantId, branchId },
      orderBy: { weekStart: 'desc' },
      take: 12,
      include: { entries: { orderBy: [{ dayOfWeek: 'asc' }, { meal: 'asc' }] } },
    });
  }

  async saveMessMenu(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: SaveMessMenuDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const weekStart = this.parseDateOnly(dto.weekStart, 'weekStart');
    if (weekStart.getUTCDay() !== 1) {
      throw new BadRequestException('weekStart must be a Monday');
    }
    const entryKeys = dto.entries.map(({ dayOfWeek, meal }) => `${dayOfWeek}:${meal}`);
    if (new Set(entryKeys).size !== entryKeys.length) {
      throw new BadRequestException('A meal can only be listed once per day');
    }

    const menu = await this.prisma.$transaction(async (tx) => {
      const savedMenu = await tx.messMenu.upsert({
        where: { tenantId_branchId_weekStart: { tenantId, branchId, weekStart } },
        create: {
          tenantId,
          branchId,
          weekStart,
          createdByUserId: actorUserId,
        },
        update: {},
      });
      await tx.messMenuEntry.deleteMany({
        where: { tenantId, branchId, menuId: savedMenu.id },
      });
      await tx.messMenuEntry.createMany({
        data: dto.entries.map((entry) => ({
          tenantId,
          branchId,
          menuId: savedMenu.id,
          dayOfWeek: entry.dayOfWeek,
          meal: entry.meal,
          description: entry.description.trim(),
        })),
      });
      return tx.messMenu.findFirstOrThrow({
        where: { id: savedMenu.id, tenantId, branchId },
        include: { entries: { orderBy: [{ dayOfWeek: 'asc' }, { meal: 'asc' }] } },
      });
    });

    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'mess.menu.save',
      module: 'mess',
      entityType: 'mess_menu',
      entityId: menu.id,
      outcome: 'success',
    });
    return menu;
  }

  async createComplaint(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateComplaintDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const title = dto.title.trim();
    const description = dto.description.trim();
    if (!title || !description) throw new BadRequestException('Title and description are required');
    const priority = dto.priority ?? 'NORMAL';
    const existing = dto.clientMutationId
      ? await this.prisma.complaint.findFirst({
          where: {
            tenantId,
            branchId,
            submittedByUserId: actorUserId,
            clientMutationId: dto.clientMutationId,
          },
          select: { id: true, title: true, description: true, priority: true, deletedAt: true },
        })
      : null;
    if (existing) {
      if (existing.deletedAt || existing.title !== title || existing.description !== description || existing.priority !== priority) {
        throw new ConflictException('This offline complaint submission key was already used');
      }
      return this.prisma.complaint.findFirstOrThrow({
        where: { id: existing.id, tenantId, branchId, deletedAt: null },
        select: complaintSelect,
      });
    }

    let complaint: Prisma.ComplaintGetPayload<{ select: typeof complaintSelect }>;
    try {
      complaint = await this.prisma.complaint.create({
        data: {
          tenantId,
          branchId,
          title,
          description,
          priority,
          submittedByUserId: actorUserId,
          ...(dto.clientMutationId ? { clientMutationId: dto.clientMutationId } : {}),
        },
        select: complaintSelect,
      });
    } catch (error) {
      if (!dto.clientMutationId || !hasPrismaErrorCode(error, 'P2002')) throw error;
      const replay = await this.prisma.complaint.findFirst({
        where: {
          tenantId,
          branchId,
          submittedByUserId: actorUserId,
          clientMutationId: dto.clientMutationId,
          deletedAt: null,
        },
        select: complaintSelect,
      });
      if (!replay || replay.title !== title || replay.description !== description || replay.priority !== priority) {
        throw new ConflictException('This offline complaint submission key was already used');
      }
      return replay;
    }
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'complaint.create',
      module: 'complaints',
      entityType: 'complaint',
      entityId: complaint.id,
      outcome: 'success',
    });
    return complaint;
  }

  async listMyComplaints(tenantId: string, branchId: string, actorUserId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.complaint.findMany({
      where: { tenantId, branchId, submittedByUserId: actorUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: complaintSelect,
    });
  }

  async listComplaintQueue(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.complaint.findMany({
      where: { tenantId, branchId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: complaintSelect,
    });
  }

  async assignComplaintToSelf(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    complaintId: string,
  ) {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId, tenantId, branchId, deletedAt: null },
      select: complaintSelect,
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    if (complaint.status === 'CLOSED') {
      throw new ConflictException('Closed complaints cannot be assigned');
    }
    if (complaint.assignedToUserId && complaint.assignedToUserId !== actorUserId) {
      throw new ConflictException('Complaint is already assigned to another staff member');
    }
    const result = await this.prisma.complaint.updateMany({
      where: {
        id: complaintId,
        tenantId,
        branchId,
        deletedAt: null,
        status: complaint.status,
        assignedToUserId: complaint.assignedToUserId,
      },
      data: {
        assignedToUserId: actorUserId,
        status: complaint.status === 'OPEN' ? 'IN_PROGRESS' : complaint.status,
      },
    });
    if (result.count !== 1) throw new ConflictException('Complaint was changed by another staff member');
    const updated = await this.prisma.complaint.findFirstOrThrow({
      where: { id: complaintId, tenantId, branchId, deletedAt: null },
      select: complaintSelect,
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'complaint.assign',
      module: 'complaints',
      entityType: 'complaint',
      entityId: complaintId,
      beforeData: { status: complaint.status, assignedToUserId: complaint.assignedToUserId },
      afterData: { status: updated.status, assignedToUserId: updated.assignedToUserId },
      outcome: 'success',
    });
    return updated;
  }

  async updateComplaint(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    complaintId: string,
    dto: UpdateComplaintDto,
  ) {
    const current = await this.prisma.complaint.findFirst({
      where: { id: complaintId, tenantId, branchId, deletedAt: null },
      select: complaintSelect,
    });
    if (!current) throw new NotFoundException('Complaint not found');

    if (dto.status === 'CLOSED' && current.status !== 'RESOLVED') {
      throw new ConflictException('A complaint must be resolved before it can be closed');
    }
    const result = await this.prisma.complaint.updateMany({
      where: {
        id: complaintId,
        tenantId,
        branchId,
        deletedAt: null,
        status: current.status,
      },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status === 'RESOLVED'
          ? { resolvedAt: new Date() }
          : dto.status && dto.status !== 'CLOSED'
            ? { resolvedAt: null }
            : {}),
      },
    });
    if (result.count !== 1) throw new ConflictException('Complaint was changed by another staff member');
    const updated = await this.prisma.complaint.findFirstOrThrow({
      where: { id: complaintId, tenantId, branchId, deletedAt: null },
      select: complaintSelect,
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'complaint.update',
      module: 'complaints',
      entityType: 'complaint',
      entityId: complaintId,
      beforeData: { status: current.status, priority: current.priority },
      afterData: { status: updated.status, priority: updated.priority },
      outcome: 'success',
    });
    return updated;
  }

  async archiveComplaint(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    complaintId: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId, tenantId, branchId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    if (complaint.status !== 'RESOLVED' && complaint.status !== 'CLOSED') {
      throw new ConflictException('Only resolved or closed complaints can be archived');
    }
    const deletedAt = new Date();
    const result = await this.prisma.complaint.updateMany({
      where: {
        id: complaintId,
        tenantId,
        branchId,
        deletedAt: null,
        status: complaint.status,
      },
      data: { deletedAt },
    });
    if (result.count !== 1) throw new ConflictException('Complaint was changed by another staff member');
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'complaint.archive',
      module: 'complaints',
      entityType: 'complaint',
      entityId: complaintId,
      beforeData: { status: complaint.status },
      outcome: 'success',
    });
    return { id: complaintId, archivedAt: deletedAt };
  }

  async listPublishedNotices(tenantId: string, branchId: string) {
    const { timezone } = await this.ensureBranch(tenantId, branchId);
    const today = this.dateInTimezone(timezone);
    return this.prisma.notice.findMany({
      where: {
        tenantId,
        branchId,
        status: 'PUBLISHED',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: today } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async listManagedNotices(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.notice.findMany({
      where: { tenantId, branchId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async createNotice(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateNoticeDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const title = dto.title.trim();
    const body = dto.body.trim();
    if (!title || !body) throw new BadRequestException('Title and body are required');
    const startsAt = dto.startsAt ? this.parseDateOnly(dto.startsAt, 'startsAt') : null;
    const endsAt = dto.endsAt ? this.parseDateOnly(dto.endsAt, 'endsAt') : null;
    this.validateNoticeWindow(startsAt, endsAt);
    const notice = await this.prisma.notice.create({
      data: {
        tenantId,
        branchId,
        title,
        body,
        startsAt,
        endsAt,
        createdByUserId: actorUserId,
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'notice.create',
      module: 'notices',
      entityType: 'notice',
      entityId: notice.id,
      outcome: 'success',
    });
    return notice;
  }

  async updateNotice(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    noticeId: string,
    dto: UpdateNoticeDto,
  ) {
    const current = await this.prisma.notice.findFirst({
      where: { id: noticeId, tenantId, branchId },
    });
    if (!current) throw new NotFoundException('Notice not found');
    const startsAt = dto.startsAt === undefined
      ? current.startsAt
      : dto.startsAt === null
        ? null
        : this.parseDateOnly(dto.startsAt, 'startsAt');
    const endsAt = dto.endsAt === undefined
      ? current.endsAt
      : dto.endsAt === null
        ? null
        : this.parseDateOnly(dto.endsAt, 'endsAt');
    this.validateNoticeWindow(startsAt, endsAt);

    const status = dto.status ?? current.status;
    const notice = await this.prisma.notice.update({
      where: { id: noticeId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(dto.status !== undefined
          ? {
              status,
              publishedAt: status === 'PUBLISHED'
                ? current.publishedAt ?? new Date()
                : null,
            }
          : {}),
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'notice.update',
      module: 'notices',
      entityType: 'notice',
      entityId: noticeId,
      beforeData: { status: current.status },
      afterData: { status: notice.status },
      outcome: 'success',
    });
    if (notice.status === 'PUBLISHED' && current.status !== 'PUBLISHED') {
      await this.notifications?.schedulePublishedAnnouncement(tenantId, branchId, notice.id);
    }
    return notice;
  }

  private async ensureBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { tenant: { select: { timezone: true } } },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return { timezone: branch.tenant.timezone };
  }

  private parseDateOnly(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    return date;
  }

  private validateNoticeWindow(startsAt: Date | null, endsAt: Date | null) {
    if (startsAt && endsAt && startsAt > endsAt) {
      throw new BadRequestException('endsAt must be on or after startsAt');
    }
  }

  private dateInTimezone(timezone: string): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    return this.parseDateOnly(date, 'today');
  }
}
