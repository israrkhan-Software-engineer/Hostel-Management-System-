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
  UpdateBedDto,
  UpdateBuildingDto,
  UpdateFloorDto,
  UpdateRoomDto,
} from './inventory.dto';
import { Prisma } from '@prisma/client';

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

  async updateBuilding(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    buildingId: string,
    dto: UpdateBuildingDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (dto.name === undefined || !dto.name.trim()) {
      throw new ConflictException('A non-empty building name is required');
    }
    const result = await this.prisma.building.updateMany({
      where: { id: buildingId, tenantId, branchId, deletedAt: null },
      data: { name: dto.name.trim() },
    });
    if (result.count !== 1) throw new NotFoundException('Building not found in this branch');
    await this.auditInventoryChange(tenantId, branchId, actorUserId, 'building.update', 'building', buildingId);
    return this.prisma.building.findFirstOrThrow({
      where: { id: buildingId, tenantId, branchId, deletedAt: null },
    });
  }

  async archiveBuilding(tenantId: string, branchId: string, actorUserId: string, buildingId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.archiveInventoryRecord(tenantId, branchId, actorUserId, 'building', buildingId, async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM buildings
        WHERE id = ${buildingId}::uuid AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      const building = await tx.building.findFirst({
        where: { id: buildingId, tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!building) throw new NotFoundException('Building not found in this branch');
      const floorCount = await tx.floor.count({ where: { tenantId, buildingId, deletedAt: null } });
      if (floorCount) throw new ConflictException('A building can only be archived after its floors are archived');
    });
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

    const floor = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM buildings
        WHERE id = ${building.id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;
      const activeBuilding = await tx.building.findFirst({
        where: { id: building.id, tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!activeBuilding) throw new NotFoundException('Building not found in this branch');
      return tx.floor.create({
        data: {
          tenantId,
          buildingId: activeBuilding.id,
          level: dto.level,
          name: dto.name?.trim() || null,
        },
      });
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

  async updateFloor(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    floorId: string,
    dto: UpdateFloorDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (dto.level === undefined && dto.name === undefined) {
      throw new ConflictException('At least one floor field must be provided');
    }
    const result = await this.prisma.floor.updateMany({
      where: {
        id: floorId,
        tenantId,
        deletedAt: null,
        building: { tenantId, branchId, deletedAt: null },
      },
      data: {
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.name !== undefined ? { name: dto.name?.trim() || null } : {}),
      },
    });
    if (result.count !== 1) throw new NotFoundException('Floor not found in this branch');
    await this.auditInventoryChange(tenantId, branchId, actorUserId, 'floor.update', 'floor', floorId);
    return this.prisma.floor.findFirstOrThrow({
      where: {
        id: floorId,
        tenantId,
        building: { tenantId, branchId },
      },
    });
  }

  async archiveFloor(tenantId: string, branchId: string, actorUserId: string, floorId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.archiveInventoryRecord(tenantId, branchId, actorUserId, 'floor', floorId, async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT f.id FROM floors f
        JOIN buildings b ON b.id = f.building_id
        WHERE f.id = ${floorId}::uuid AND f.tenant_id = ${tenantId}::uuid
          AND f.deleted_at IS NULL AND b.tenant_id = ${tenantId}::uuid
          AND b.branch_id = ${branchId}::uuid AND b.deleted_at IS NULL
        FOR UPDATE OF f
      `;
      const floor = await tx.floor.findFirst({
        where: { id: floorId, tenantId, deletedAt: null, building: { tenantId, branchId, deletedAt: null } },
        select: { id: true },
      });
      if (!floor) throw new NotFoundException('Floor not found in this branch');
      const roomCount = await tx.room.count({ where: { tenantId, floorId, deletedAt: null } });
      if (roomCount) throw new ConflictException('A floor can only be archived after its rooms are archived');
    });
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
    try {
      const room = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM floors
          WHERE id = ${dto.floorId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        const floor = await tx.floor.findFirst({
          where: {
            id: dto.floorId,
            tenantId,
            deletedAt: null,
            building: { tenantId, branchId, deletedAt: null },
          },
          select: { id: true },
        });
        if (!floor) throw new NotFoundException('Floor not found in this branch');
        return tx.room.create({
          data: {
            tenantId,
            branchId,
            floorId: floor.id,
            code: dto.code.trim(),
            bedCapacity: dto.bedCapacity,
          },
        });
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

  async updateRoom(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    roomId: string,
    dto: UpdateRoomDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (dto.code === undefined && dto.bedCapacity === undefined) {
      throw new ConflictException('At least one room field must be provided');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM rooms
          WHERE id = ${roomId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND branch_id = ${branchId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        const room = await tx.room.findFirst({
          where: { id: roomId, tenantId, branchId, deletedAt: null },
          select: { id: true },
        });
        if (!room) throw new NotFoundException('Room not found in this branch');
        if (dto.bedCapacity !== undefined) {
          const currentBeds = await tx.bed.count({
            where: { tenantId, branchId, roomId, deletedAt: null },
          });
          if (dto.bedCapacity < currentBeds) {
            throw new ConflictException('Room capacity cannot be less than the number of active beds');
          }
        }
        const result = await tx.room.updateMany({
          where: { id: roomId, tenantId, branchId, deletedAt: null },
          data: {
            ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
            ...(dto.bedCapacity !== undefined ? { bedCapacity: dto.bedCapacity } : {}),
          },
        });
        if (result.count !== 1) throw new NotFoundException('Room not found in this branch');
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A room with this code already exists in the tenant');
      }
      throw error;
    }
    await this.auditInventoryChange(tenantId, branchId, actorUserId, 'room.update', 'room', roomId);
    return this.prisma.room.findFirstOrThrow({ where: { id: roomId, tenantId, branchId } });
  }

  async archiveRoom(tenantId: string, branchId: string, actorUserId: string, roomId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.archiveInventoryRecord(tenantId, branchId, actorUserId, 'room', roomId, async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM rooms
        WHERE id = ${roomId}::uuid AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      const room = await tx.room.findFirst({
        where: { id: roomId, tenantId, branchId, deletedAt: null },
        select: { id: true },
      });
      if (!room) throw new NotFoundException('Room not found in this branch');
      const bedCount = await tx.bed.count({ where: { tenantId, branchId, roomId, deletedAt: null } });
      if (bedCount) throw new ConflictException('A room can only be archived after its beds are archived');
    });
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

  async updateBed(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    bedId: string,
    dto: UpdateBedDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    if (dto.code === undefined || !dto.code.trim()) {
      throw new ConflictException('A non-empty bed code is required');
    }
    try {
      const result = await this.prisma.bed.updateMany({
        where: { id: bedId, tenantId, branchId, deletedAt: null },
        data: { code: dto.code.trim() },
      });
      if (result.count !== 1) throw new NotFoundException('Bed not found in this branch');
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A bed with this code already exists in the room');
      }
      throw error;
    }
    await this.auditInventoryChange(tenantId, branchId, actorUserId, 'bed.update', 'bed', bedId);
    return this.prisma.bed.findFirstOrThrow({
      where: { id: bedId, tenantId, branchId, deletedAt: null },
      include: { room: { select: { id: true, code: true } } },
    });
  }

  async archiveBed(tenantId: string, branchId: string, actorUserId: string, bedId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.archiveInventoryRecord(tenantId, branchId, actorUserId, 'bed', bedId, async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM beds
        WHERE id = ${bedId}::uuid AND tenant_id = ${tenantId}::uuid
          AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      const bed = await tx.bed.findFirst({
        where: { id: bedId, tenantId, branchId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!bed) throw new NotFoundException('Bed not found in this branch');
      if (bed.status !== 'AVAILABLE') throw new ConflictException('Only available beds can be archived');
      const activeAllocation = await tx.bedAllocation.findFirst({
        where: { tenantId, branchId, bedId, endedAt: null },
        select: { id: true },
      });
      if (activeAllocation) throw new ConflictException('A bed with an active allocation cannot be archived');
    });
  }

  private async archiveInventoryRecord(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    entityType: 'building' | 'floor' | 'room' | 'bed',
    entityId: string,
    validateArchive: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const deletedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await validateArchive(tx);
      switch (entityType) {
        case 'building':
          return tx.building.updateMany({
            where: { id: entityId, tenantId, branchId, deletedAt: null },
            data: { deletedAt },
          });
        case 'floor':
          return tx.floor.updateMany({
            where: {
              id: entityId,
              tenantId,
              deletedAt: null,
              building: { tenantId, branchId, deletedAt: null },
            },
            data: { deletedAt },
          });
        case 'room':
          return tx.room.updateMany({
            where: { id: entityId, tenantId, branchId, deletedAt: null },
            data: { deletedAt },
          });
        case 'bed':
          return tx.bed.updateMany({
            where: { id: entityId, tenantId, branchId, deletedAt: null, status: 'AVAILABLE' },
            data: { deletedAt },
          });
      }
    });
    if (result.count !== 1) throw new NotFoundException(`${entityType} not found in this branch`);
    await this.auditInventoryChange(
      tenantId,
      branchId,
      actorUserId,
      `${entityType}.archive`,
      entityType,
      entityId,
    );
    return { id: entityId, deletedAt };
  }

  private auditInventoryChange(
    tenantId: string,
    branchId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
  ) {
    return this.audit.log({
      tenantId,
      branchId,
      actorUserId,
      action,
      module: 'inventory',
      entityType,
      entityId,
      outcome: 'success',
    });
  }

  private async ensureBranch(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
  }
}
