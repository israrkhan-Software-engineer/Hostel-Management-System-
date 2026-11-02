import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VisitorVisitStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  decryptField,
  encryptField,
  fingerprintField,
  maskIdentityNumber,
} from '../../common/utils/field-encryption.util';
import { CreateVisitorVisitDto } from './phase5.dto';

const visitorVisitSelect = {
  id: true,
  visitorName: true,
  visitorPhone: true,
  cnicEncrypted: true,
  purpose: true,
  status: true,
  hostResidentId: true,
  createdByUserId: true,
  approvedByUserId: true,
  approvedAt: true,
  checkedInByUserId: true,
  checkedInAt: true,
  checkedOutByUserId: true,
  checkedOutAt: true,
  createdAt: true,
  updatedAt: true,
  hostResident: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.VisitorVisitSelect;

@Injectable()
export class Phase5Service {
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('app.fieldEncryptionKey');
  }

  async listVisitorVisits(tenantId: string, branchId: string, search?: string) {
    await this.ensureBranch(tenantId, branchId);
    const query = search?.trim();
    if (query && query.length > 100) {
      throw new BadRequestException('Search query must be 100 characters or fewer');
    }
    const normalizedCnic = query?.replace(/-/g, '');
    const cnicFingerprint = normalizedCnic && /^\d{13}$/.test(normalizedCnic)
      ? fingerprintField(`${tenantId}:${normalizedCnic}`, this.encryptionKey)
      : null;
    const visits = await this.prisma.visitorVisit.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        ...(query
          ? {
              OR: [
                { visitorName: { contains: query, mode: 'insensitive' } },
                { visitorPhone: { contains: query, mode: 'insensitive' } },
                ...(cnicFingerprint ? [{ cnicFingerprint }] : []),
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: visitorVisitSelect,
    });
    return visits.map((visit) => this.presentVisit(visit));
  }

  async createVisitorVisit(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateVisitorVisitDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const host = await this.prisma.resident.findFirst({
      where: {
        id: dto.hostResidentId,
        tenantId,
        branchId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!host) throw new BadRequestException('An active resident in this branch is required as the host');

    const visitorName = dto.visitorName.trim();
    const purpose = dto.purpose.trim();
    const visitorPhone = dto.visitorPhone?.trim() || null;
    const normalizedCnic = dto.cnic.replace(/-/g, '');
    if (!visitorName || !purpose) {
      throw new BadRequestException('Visitor name and visit purpose are required');
    }

    const visit = await this.prisma.visitorVisit.create({
      data: {
        tenantId,
        branchId,
        hostResidentId: host.id,
        visitorName,
        visitorPhone,
        cnicEncrypted: encryptField(normalizedCnic, this.encryptionKey),
        cnicFingerprint: fingerprintField(`${tenantId}:${normalizedCnic}`, this.encryptionKey),
        purpose,
        createdByUserId: actorUserId,
      },
      select: visitorVisitSelect,
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'visitor.register',
      module: 'visitors',
      entityType: 'visitor_visit',
      entityId: visit.id,
      afterData: { status: visit.status },
      outcome: 'success',
    });
    return this.presentVisit(visit);
  }

  approveVisitorVisit(tenantId: string, branchId: string, actorUserId: string, visitId: string) {
    return this.transitionVisitorVisit(
      tenantId,
      branchId,
      actorUserId,
      visitId,
      'PENDING',
      'APPROVED',
      { approvedByUserId: actorUserId, approvedAt: new Date() },
      'visitor.approve',
    );
  }

  rejectVisitorVisit(tenantId: string, branchId: string, actorUserId: string, visitId: string) {
    return this.transitionVisitorVisit(
      tenantId,
      branchId,
      actorUserId,
      visitId,
      'PENDING',
      'REJECTED',
      {},
      'visitor.reject',
    );
  }

  checkInVisitor(tenantId: string, branchId: string, actorUserId: string, visitId: string) {
    return this.transitionVisitorVisit(
      tenantId,
      branchId,
      actorUserId,
      visitId,
      'APPROVED',
      'CHECKED_IN',
      { checkedInByUserId: actorUserId, checkedInAt: new Date() },
      'visitor.check_in',
    );
  }

  checkOutVisitor(tenantId: string, branchId: string, actorUserId: string, visitId: string) {
    return this.transitionVisitorVisit(
      tenantId,
      branchId,
      actorUserId,
      visitId,
      'CHECKED_IN',
      'CHECKED_OUT',
      { checkedOutByUserId: actorUserId, checkedOutAt: new Date() },
      'visitor.check_out',
    );
  }

  async archiveVisitorVisit(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    visitId: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const visit = await this.prisma.visitorVisit.findFirst({
      where: { id: visitId, tenantId, branchId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!visit) throw new NotFoundException('Visitor visit not found');
    if (visit.status !== 'REJECTED' && visit.status !== 'CHECKED_OUT') {
      throw new ConflictException('Only rejected or completed visits can be archived');
    }

    const deletedAt = new Date();
    const result = await this.prisma.visitorVisit.updateMany({
      where: {
        id: visitId,
        tenantId,
        branchId,
        deletedAt: null,
        status: visit.status,
      },
      data: { deletedAt },
    });
    if (result.count !== 1) throw new ConflictException('Visitor visit was changed by another staff member');
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'visitor.archive',
      module: 'visitors',
      entityType: 'visitor_visit',
      entityId: visitId,
      beforeData: { status: visit.status },
      outcome: 'success',
    });
    return { id: visitId, archivedAt: deletedAt };
  }

  private async transitionVisitorVisit(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    visitId: string,
    requiredStatus: VisitorVisitStatus,
    nextStatus: VisitorVisitStatus,
    extraData: Prisma.VisitorVisitUncheckedUpdateManyInput,
    action: string,
  ) {
    const current = await this.prisma.visitorVisit.findFirst({
      where: { id: visitId, tenantId, branchId, deletedAt: null },
      select: visitorVisitSelect,
    });
    if (!current) throw new NotFoundException('Visitor visit not found');
    if (current.status !== requiredStatus) {
      throw new ConflictException(`Visitor visit must be ${requiredStatus} before it can become ${nextStatus}`);
    }

    const result = await this.prisma.visitorVisit.updateMany({
      where: { id: visitId, tenantId, branchId, status: requiredStatus, deletedAt: null },
      data: { status: nextStatus, ...extraData },
    });
    if (result.count !== 1) {
      throw new ConflictException('Visitor visit was changed by another staff member');
    }
    const updated = await this.prisma.visitorVisit.findFirstOrThrow({
      where: { id: visitId, tenantId, branchId, deletedAt: null },
      select: visitorVisitSelect,
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action,
      module: 'visitors',
      entityType: 'visitor_visit',
      entityId: visitId,
      beforeData: { status: current.status },
      afterData: { status: updated.status },
      outcome: 'success',
    });
    return this.presentVisit(updated);
  }

  private presentVisit<T extends { cnicEncrypted: string | null }>(visit: T) {
    const { cnicEncrypted, ...safeVisit } = visit;
    return {
      ...safeVisit,
      cnicMasked: cnicEncrypted
        ? maskIdentityNumber(decryptField(cnicEncrypted, this.encryptionKey))
        : null,
    };
  }

  private async ensureBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }
}
