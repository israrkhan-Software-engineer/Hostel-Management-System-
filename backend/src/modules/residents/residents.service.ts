import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resident } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hasPrismaErrorCode } from '../../common/utils/prisma-error.util';
import {
  CreateResidentDto,
  UpdateMyResidentProfileDto,
  UpdateResidentDto,
} from './residents.dto';
import {
  decryptField,
  encryptField,
  fingerprintField,
  maskIdentityNumber,
} from '../../common/utils/field-encryption.util';

@Injectable()
export class ResidentsService {
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('app.fieldEncryptionKey');
  }

  async create(tenantId: string, branchId: string, actorUserId: string, dto: CreateResidentDto) {
    await this.ensureBranch(tenantId, branchId);
    const normalizedCnic = dto.cnic?.replace(/-/g, '');

    try {
      const resident = await this.prisma.resident.create({
        data: {
          tenantId,
          branchId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim().toLowerCase() || null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          cnicEncrypted: normalizedCnic
            ? encryptField(normalizedCnic, this.encryptionKey)
            : null,
          cnicFingerprint: normalizedCnic
            ? fingerprintField(`${tenantId}:${normalizedCnic}`, this.encryptionKey)
            : null,
        },
      });
      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'resident.create',
        module: 'residents',
        entityType: 'resident',
        entityId: resident.id,
        outcome: 'success',
      });
      return this.present(resident);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A resident with this identity number already exists');
      }
      throw error;
    }
  }

  async list(tenantId: string, branchId: string, search?: string) {
    await this.ensureBranch(tenantId, branchId);
    const query = search?.trim();
    const normalizedCnic = query?.replace(/-/g, '');
    const isCnic = normalizedCnic ? /^\d{13}$/.test(normalizedCnic) : false;
    const isUuid = query
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query)
      : false;
    const residents = await this.prisma.resident.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
                { email: { contains: query, mode: 'insensitive' } },
                ...(isUuid ? [{ id: query }] : []),
                ...(isCnic
                  ? [{ cnicFingerprint: fingerprintField(`${tenantId}:${normalizedCnic}`, this.encryptionKey) }]
                  : []),
              ],
            }
          : {}),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 100,
    });
    return residents.map((resident) => this.present(resident));
  }

  async get(tenantId: string, branchId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, tenantId, branchId, deletedAt: null },
    });
    if (!resident) throw new NotFoundException('Resident not found');
    return this.present(resident);
  }

  async getMyResident(tenantId: string, branchId: string, userId: string) {
    await this.ensureBranch(tenantId, branchId);
    const resident = await this.prisma.resident.findFirst({
      where: { tenantId, branchId, userId, deletedAt: null },
      include: {
        allocations: {
          where: { endedAt: null, status: { in: ['RESERVED', 'CHECKED_IN'] } },
          orderBy: { allocatedAt: 'desc' },
          take: 1,
          include: {
            bed: {
              include: {
                room: {
                  include: {
                    floor: { include: { building: { select: { name: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!resident) throw new NotFoundException('Student account is not linked to a resident record');
    const [allocation] = resident.allocations;
    return {
      ...this.present(resident),
      dateOfBirth: resident.dateOfBirth,
      room: allocation
        ? {
            building: allocation.bed.room.floor.building.name,
            floor: allocation.bed.room.floor.name ?? String(allocation.bed.room.floor.level),
            room: allocation.bed.room.code,
            bed: allocation.bed.code,
            allocationStatus: allocation.status,
            checkedInAt: allocation.checkedInAt,
          }
        : null,
    };
  }

  async updateMyProfile(
    tenantId: string,
    branchId: string,
    userId: string,
    dto: UpdateMyResidentProfileDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const existing = await this.prisma.resident.findFirst({
      where: { tenantId, branchId, userId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Student account is not linked to a resident record');

    const updated = await this.prisma.resident.update({
      where: { id: existing.id },
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.dateOfBirth !== undefined
          ? { dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null }
          : {}),
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: 'resident.self_update',
      module: 'residents',
      entityType: 'resident',
      entityId: existing.id,
      outcome: 'success',
    });
    return this.present(updated);
  }

  async linkAccountByEmail(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    residentId: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, tenantId, branchId, deletedAt: null },
    });
    if (!resident) throw new NotFoundException('Resident not found');
    if (!resident.email) throw new BadRequestException('Add the student account email to the resident record first');
    if (resident.userId) throw new ConflictException('This resident is already linked to a student account');

    const user = await this.prisma.user.findFirst({
      where: {
        tenantId,
        email: { equals: resident.email.trim(), mode: 'insensitive' },
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: {
          some: {
            tenantId,
            role: { name: 'Resident', deletedAt: null },
          },
        },
      },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('No active student account with the same email was found');
    }

    try {
      const result = await this.prisma.resident.updateMany({
        where: { id: resident.id, tenantId, branchId, userId: null },
        data: { userId: user.id },
      });
      if (!result.count) throw new ConflictException('This resident was linked to a student account by another request');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('This student account is already linked to another resident');
      }
      throw error;
    }
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'resident.account.link',
      module: 'residents',
      entityType: 'resident',
      entityId: resident.id,
      outcome: 'success',
    });
    return { linked: true };
  }

  async update(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    residentId: string,
    dto: UpdateResidentDto,
  ) {
    const existing = await this.prisma.resident.findFirst({
      where: { id: residentId, tenantId, branchId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Resident not found');

    const updated = await this.prisma.resident.update({
      where: { id: residentId },
      data: {
        ...(dto.firstName !== undefined
          ? { firstName: dto.firstName?.trim() || existing.firstName }
          : {}),
        ...(dto.lastName !== undefined
          ? { lastName: dto.lastName?.trim() || existing.lastName }
          : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim().toLowerCase() || null } : {}),
        ...(dto.dateOfBirth !== undefined
          ? { dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null }
          : {}),
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'resident.update',
      module: 'residents',
      entityType: 'resident',
      entityId: residentId,
      outcome: 'success',
    });
    return this.present(updated);
  }

  async deactivate(tenantId: string, branchId: string, actorUserId: string, residentId: string) {
    const existing = await this.prisma.resident.findFirst({
      where: { id: residentId, tenantId, branchId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Resident not found');
    const activeAllocation = await this.prisma.bedAllocation.findFirst({
      where: { tenantId, branchId, residentId, endedAt: null },
      select: { id: true },
    });
    if (activeAllocation) {
      throw new ConflictException('A resident with an active bed allocation cannot be deactivated');
    }
    const resident = await this.prisma.resident.update({
      where: { id: residentId },
      data: { status: 'INACTIVE', deletedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'resident.deactivate',
      module: 'residents',
      entityType: 'resident',
      entityId: residentId,
      outcome: 'success',
    });
    return this.present(resident);
  }

  async ensureBranch(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }

  private present(resident: Resident) {
    return {
      id: resident.id,
      tenantId: resident.tenantId,
      branchId: resident.branchId,
      firstName: resident.firstName,
      lastName: resident.lastName,
      phone: resident.phone,
      email: resident.email,
      accountLinked: Boolean(resident.userId),
      dateOfBirth: resident.dateOfBirth,
      status: resident.status,
      createdAt: resident.createdAt,
      updatedAt: resident.updatedAt,
      deletedAt: resident.deletedAt,
      cnicMasked: resident.cnicEncrypted
        ? maskIdentityNumber(decryptField(resident.cnicEncrypted, this.encryptionKey))
        : null,
    };
  }

  presentForAdmission(resident: Resident) {
    return this.present(resident);
  }
}
