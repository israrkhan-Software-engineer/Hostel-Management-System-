import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hasPrismaErrorCode } from '../../common/utils/prisma-error.util';
import {
  CreateBedDto,
  CreateBuildingDto,
  CreateFloorDto,
  CreateRoomDto,
} from './inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listBuildings(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.building.findMany({
      where: { tenantId, branchId, deletedAt: null },
      include: {
        floors: {
          where: { deletedAt: null },
          orderBy: { level: 'asc' },
          include: {
            rooms: {
              where: { deletedAt: null },
              orderBy: { code: 'asc' },
              include: { _count: { select: { beds: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createBuilding(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateBuildingDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const building = await this.prisma.building.create({
      data: { tenantId, branchId, name: dto.name.trim() },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'building.create',
      module: 'inventory',
      entityType: 'building',
      entityId: building.id,
      outcome: 'success',
    });
    return building;
  }

  async createFloor(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateFloorDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const building = await this.prisma.building.findFirst({
      where: { id: dto.buildingId, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!building) throw new NotFoundException('Building not found in this branch');

    const floor = await this.prisma.floor.create({
      data: {
        tenantId,
        buildingId: building.id,
        level: dto.level,
        name: dto.name?.trim() || null,
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action: 'floor.create',
      module: 'inventory',
      entityType: 'floor',
      entityId: floor.id,
      outcome: 'success',
    });
    return floor;
  }

  async listRooms(tenantId: string, branchId: string, floorId?: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.room.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        ...(floorId ? { floorId } : {}),
      },
      include: {
        floor: {
          select: {
            id: true,
            level: true,
            name: true,
            building: { select: { id: true, name: true } },
          },
        },
        _count: { select: { beds: true } },
      },
      orderBy: { code: 'asc' },
      take: 500,
    });
  }

  async createRoom(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateRoomDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const floor = await this.prisma.floor.findFirst({
      where: {
        id: dto.floorId,
        tenantId,
        deletedAt: null,
        building: { tenantId, branchId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!floor) throw new NotFoundException('Floor not found in this branch');

    try {
      const room = await this.prisma.room.create({
        data: {
          tenantId,
          branchId,
          floorId: floor.id,
          code: dto.code.trim(),
          bedCapacity: dto.bedCapacity,
        },
      });
      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'room.create',
        module: 'inventory',
        entityType: 'room',
        entityId: room.id,
        outcome: 'success',
      });
      return room;
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A room with this code already exists in the tenant');
      }
      throw error;
    }
  }

  async listBeds(tenantId: string, branchId: string, roomId?: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.bed.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        ...(roomId ? { roomId } : {}),
      },
      include: { room: { select: { id: true, code: true } } },
      orderBy: [{ room: { code: 'asc' } }, { code: 'asc' }],
      take: 1000,
    });
  }

  async createBed(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    dto: CreateBedDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    try {
      const bed = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM rooms
          WHERE id = ${dto.roomId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND branch_id = ${branchId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        const room = await tx.room.findFirst({
          where: { id: dto.roomId, tenantId, branchId, deletedAt: null },
          select: { id: true, bedCapacity: true },
        });
        if (!room) throw new NotFoundException('Room not found in this branch');

        const currentBeds = await tx.bed.count({
          where: { tenantId, branchId, roomId: room.id, deletedAt: null },
        });
        if (currentBeds >= room.bedCapacity) {
          throw new ConflictException('Room has reached its configured bed capacity');
        }
        return tx.bed.create({
          data: {
            tenantId,
            branchId,
            roomId: room.id,
            code: dto.code.trim(),
          },
          include: { room: { select: { id: true, code: true } } },
        });
      });
      await this.audit.log({
        tenantId,
        branchId,
        actorUserId,
        action: 'bed.create',
        module: 'inventory',
        entityType: 'bed',
        entityId: bed.id,
        outcome: 'success',
      });
      return bed;
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A bed with this code already exists in the room');
      }
      throw error;
    }
  }

  private async ensureBranch(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }
}
