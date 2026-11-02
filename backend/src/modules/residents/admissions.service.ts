import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdmissionStatus, Resident } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hasPrismaErrorCode } from '../../common/utils/prisma-error.util';
import {
  AdmissionDecisionDto,
  CreateAdmissionDto,
  UpdateAdmissionDto,
} from './residents.dto';
import { ResidentsService } from './residents.service';

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly residents: ResidentsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, branchId: string, status?: AdmissionStatus) {
    await this.residents.ensureBranch(tenantId, branchId);
    const admissions = await this.prisma.admission.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      include: {
        resident: true,
        allocations: {
          where: { endedAt: null },
          include: { bed: { include: { room: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return admissions.map(({ resident, ...admission }) => ({
      ...admission,
      resident: this.residents.presentForAdmission(resident),
    }));
  }

  async create(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateAdmissionDto,
  ) {
    await this.residents.ensureBranch(tenantId, branchId);

    const admission = await this.prisma.$transaction(async (tx) => {
      const residentRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM residents
        WHERE id = ${dto.residentId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid
          AND status = 'ACTIVE'
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      const resident = residentRows[0];
      if (!resident) throw new NotFoundException('Active resident not found in this branch');

      const existingAdmission = await tx.admission.findFirst({
        where: {
          tenantId,
          branchId,
          residentId: resident.id,
          status: { in: ['PENDING', 'APPROVED', 'CHECKED_IN'] },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingAdmission) {
        throw new ConflictException('Resident already has an active admission');
      }

      return tx.admission.create({
        data: {
          tenantId,
          branchId,
          residentId: resident.id,
          requestedCheckInAt: dto.requestedCheckInAt ? new Date(dto.requestedCheckInAt) : null,
          notes: dto.notes?.trim() || null,
        },
        include: { resident: true },
      });
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'admission.create',
      module: 'admissions',
      entityType: 'admission',
      entityId: admission.id,
      outcome: 'success',
    });
    const { resident: admissionResident, ...result } = admission;
    return { ...result, resident: this.residents.presentForAdmission(admissionResident) };
  }

  async decide(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    admissionId: string,
    dto: AdmissionDecisionDto,
  ) {
    await this.residents.ensureBranch(tenantId, branchId);
    if (dto.decision === 'REJECTED' && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting an admission');
    }

    const result = await this.prisma.admission.updateMany({
      where: {
        id: admissionId,
        tenantId,
        branchId,
        status: 'PENDING',
        deletedAt: null,
      },
      data: {
        status: dto.decision,
        rejectionReason: dto.decision === 'REJECTED' ? dto.rejectionReason!.trim() : null,
        decidedByUserId: actorUserId,
        decidedAt: new Date(),
      },
    });
    if (result.count === 0) {
      const exists = await this.prisma.admission.findFirst({
        where: { id: admissionId, tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Admission not found');
      throw new ConflictException('Only pending admissions can be approved or rejected');
    }

    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: `admission.${dto.decision.toLowerCase()}`,
      module: 'admissions',
      entityType: 'admission',
      entityId: admissionId,
      outcome: 'success',
    });
    return this.get(tenantId, branchId, admissionId);
  }

  async update(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    admissionId: string,
    dto: UpdateAdmissionDto,
  ) {
    await this.residents.ensureBranch(tenantId, branchId);
    if (dto.requestedCheckInAt === undefined && dto.notes === undefined) {
      throw new BadRequestException('At least one admission field must be provided');
    }

    const result = await this.prisma.admission.updateMany({
      where: {
        id: admissionId,
        tenantId,
        branchId,
        status: 'PENDING',
        deletedAt: null,
      },
      data: {
        ...(dto.requestedCheckInAt !== undefined
          ? { requestedCheckInAt: dto.requestedCheckInAt ? new Date(dto.requestedCheckInAt) : null }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      },
    });
    if (result.count !== 1) {
      const current = await this.prisma.admission.findFirst({
        where: { id: admissionId, tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!current) throw new NotFoundException('Admission not found');
      throw new ConflictException('Only pending admissions can be edited');
    }

    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'admission.update',
      module: 'admissions',
      entityType: 'admission',
      entityId: admissionId,
      outcome: 'success',
    });
    return this.get(tenantId, branchId, admissionId);
  }

  async cancel(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    admissionId: string,
  ) {
    await this.residents.ensureBranch(tenantId, branchId);
    const result = await this.prisma.admission.updateMany({
      where: {
        id: admissionId,
        tenantId,
        branchId,
        status: 'PENDING',
        deletedAt: null,
      },
      data: {
        status: 'CANCELLED',
        decidedByUserId: actorUserId,
        decidedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      const current = await this.prisma.admission.findFirst({
        where: { id: admissionId, tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!current) throw new NotFoundException('Admission not found');
      throw new ConflictException('Only pending admissions can be cancelled');
    }

    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'admission.cancel',
      module: 'admissions',
      entityType: 'admission',
      entityId: admissionId,
      outcome: 'success',
    });
    return this.get(tenantId, branchId, admissionId);
  }

  async availableBeds(tenantId: string, branchId: string) {
    await this.residents.ensureBranch(tenantId, branchId);
    return this.prisma.bed.findMany({
      where: {
        tenantId,
        branchId,
        status: 'AVAILABLE',
        deletedAt: null,
        room: { deletedAt: null },
      },
      select: {
        id: true,
        code: true,
        room: { select: { id: true, code: true, floor: { select: { name: true, level: true } } } },
      },
      orderBy: [{ room: { code: 'asc' } }, { code: 'asc' }],
      take: 200,
    });
  }

  async allocateBed(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    admissionId: string,
    bedId: string,
  ) {
    await this.residents.ensureBranch(tenantId, branchId);
    try {
      const allocation = await this.prisma.$transaction(async (tx) => {
        const admission = await tx.admission.findFirst({
          where: {
            id: admissionId,
            tenantId,
            branchId,
            status: 'APPROVED',
            deletedAt: null,
          },
        });
        if (!admission) {
          const exists = await tx.admission.findFirst({
            where: { id: admissionId, tenantId, branchId, deletedAt: null },
            select: { id: true },
          });
          if (!exists) throw new NotFoundException('Admission not found');
          throw new ConflictException('Bed assignment requires an approved admission');
        }

        const bed = await tx.bed.findFirst({
          where: { id: bedId, tenantId, branchId, status: 'AVAILABLE', deletedAt: null },
          select: { id: true },
        });
        if (!bed) throw new ConflictException('Bed is unavailable or does not belong to this branch');

        const reserved = await tx.bed.updateMany({
          where: { id: bed.id, tenantId, branchId, status: 'AVAILABLE', deletedAt: null },
          data: { status: 'RESERVED' },
        });
        if (reserved.count !== 1) throw new ConflictException('Bed is no longer available');

        return tx.bedAllocation.create({
          data: {
            tenantId,
            branchId,
            admissionId,
            residentId: admission.residentId,
            bedId: bed.id,
          },
          include: { bed: { include: { room: true } } },
        });
      });
      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'allocation.assign',
        module: 'allocations',
        entityType: 'bed_allocation',
        entityId: allocation.id,
        outcome: 'success',
      });
      return allocation;
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('This admission, resident, or bed already has an active allocation');
      }
      throw error;
    }
  }

  async checkIn(tenantId: string, branchId: string, actorUserId: string, admissionId: string) {
    await this.residents.ensureBranch(tenantId, branchId);
    const result = await this.prisma.$transaction(async (tx) => {
      const allocation = await tx.bedAllocation.findFirst({
        where: { admissionId, tenantId, branchId, status: 'RESERVED', endedAt: null },
      });
      if (!allocation) throw new ConflictException('A reserved bed allocation is required to check in');

      const bed = await tx.bed.updateMany({
        where: { id: allocation.bedId, tenantId, branchId, status: 'RESERVED', deletedAt: null },
        data: { status: 'OCCUPIED' },
      });
      const admission = await tx.admission.updateMany({
        where: { id: admissionId, tenantId, branchId, status: 'APPROVED', deletedAt: null },
        data: { status: 'CHECKED_IN', checkedInAt: new Date() },
      });
      const updatedAllocation = await tx.bedAllocation.updateMany({
        where: { id: allocation.id, tenantId, branchId, status: 'RESERVED', endedAt: null },
        data: { status: 'CHECKED_IN', checkedInAt: new Date() },
      });
      if (bed.count !== 1 || admission.count !== 1 || updatedAllocation.count !== 1) {
        throw new ConflictException('Admission or bed allocation changed; refresh and try again');
      }
      return tx.admission.findFirstOrThrow({
        where: { id: admissionId, tenantId, branchId },
        include: {
          resident: true,
          allocations: {
            where: { endedAt: null },
            include: { bed: { include: { room: true } } },
          },
        },
      });
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'admission.check_in',
      module: 'admissions',
      entityType: 'admission',
      entityId: admissionId,
      outcome: 'success',
    });
    return this.presentAdmission(result);
  }

  async checkOut(tenantId: string, branchId: string, actorUserId: string, admissionId: string) {
    await this.residents.ensureBranch(tenantId, branchId);
    const result = await this.prisma.$transaction(async (tx) => {
      const allocation = await tx.bedAllocation.findFirst({
        where: { admissionId, tenantId, branchId, status: 'CHECKED_IN', endedAt: null },
      });
      if (!allocation) throw new ConflictException('A checked-in allocation is required to check out');

      const bed = await tx.bed.updateMany({
        where: { id: allocation.bedId, tenantId, branchId, status: 'OCCUPIED', deletedAt: null },
        data: { status: 'AVAILABLE' },
      });
      const admission = await tx.admission.updateMany({
        where: { id: admissionId, tenantId, branchId, status: 'CHECKED_IN', deletedAt: null },
        data: { status: 'CHECKED_OUT', checkedOutAt: new Date() },
      });
      const endedAllocation = await tx.bedAllocation.updateMany({
        where: { id: allocation.id, tenantId, branchId, status: 'CHECKED_IN', endedAt: null },
        data: { status: 'ENDED', endedAt: new Date() },
      });
      if (bed.count !== 1 || admission.count !== 1 || endedAllocation.count !== 1) {
        throw new ConflictException('Admission or bed allocation changed; refresh and try again');
      }
      return tx.admission.findFirstOrThrow({
        where: { id: admissionId, tenantId, branchId },
        include: {
          resident: true,
          allocations: {
            where: { endedAt: null },
            include: { bed: { include: { room: true } } },
          },
        },
      });
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'admission.check_out',
      module: 'admissions',
      entityType: 'admission',
      entityId: admissionId,
      outcome: 'success',
    });
    return this.presentAdmission(result);
  }

  async get(tenantId: string, branchId: string, admissionId: string) {
    await this.residents.ensureBranch(tenantId, branchId);
    const admission = await this.prisma.admission.findFirst({
      where: { id: admissionId, tenantId, branchId, deletedAt: null },
      include: {
        resident: true,
        allocations: {
          where: { endedAt: null },
          include: { bed: { include: { room: true } } },
        },
      },
    });
    if (!admission) throw new NotFoundException('Admission not found');
    return this.presentAdmission(admission);
  }

  private presentAdmission<T extends { resident: Resident }>(admission: T) {
    const { resident, ...data } = admission;
    return { ...data, resident: this.residents.presentForAdmission(resident) };
  }
}
