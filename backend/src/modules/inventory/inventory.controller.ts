import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId/inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('buildings')
  @RequirePermission('inventory', 'view')
  listBuildings(@Param('branchId', ParseUUIDPipe) branchId: string, @CurrentUser() user: RequestUser) {
    return this.inventory.listBuildings(user.tenantId, branchId);
  }

  @Post('buildings')
  @RequirePermission('inventory', 'create')
  createBuilding(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBuildingDto,
  ) {
    return this.inventory.createBuilding(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('buildings/:buildingId')
  @RequirePermission('inventory', 'edit')
  updateBuilding(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateBuildingDto,
  ) {
    return this.inventory.updateBuilding(user.tenantId, branchId, user.userId, buildingId, dto);
  }

  @Delete('buildings/:buildingId')
  @RequirePermission('inventory', 'delete')
  archiveBuilding(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventory.archiveBuilding(user.tenantId, branchId, user.userId, buildingId);
  }

  @Post('floors')
  @RequirePermission('inventory', 'create')
  createFloor(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFloorDto,
  ) {
    return this.inventory.createFloor(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('floors/:floorId')
  @RequirePermission('inventory', 'edit')
  updateFloor(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateFloorDto,
  ) {
    return this.inventory.updateFloor(user.tenantId, branchId, user.userId, floorId, dto);
  }

  @Delete('floors/:floorId')
  @RequirePermission('inventory', 'delete')
  archiveFloor(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventory.archiveFloor(user.tenantId, branchId, user.userId, floorId);
  }

  @Get('rooms')
  @RequirePermission('inventory', 'view')
  listRooms(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query('floorId') floorId?: string,
  ) {
    return this.inventory.listRooms(user.tenantId, branchId, floorId);
  }

  @Post('rooms')
  @RequirePermission('inventory', 'create')
  createRoom(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateRoomDto,
  ) {
    return this.inventory.createRoom(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('rooms/:roomId')
  @RequirePermission('inventory', 'edit')
  updateRoom(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.inventory.updateRoom(user.tenantId, branchId, user.userId, roomId, dto);
  }

  @Delete('rooms/:roomId')
  @RequirePermission('inventory', 'delete')
  archiveRoom(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventory.archiveRoom(user.tenantId, branchId, user.userId, roomId);
  }

  @Get('beds')
  @RequirePermission('inventory', 'view')
  listBeds(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query('roomId') roomId?: string,
  ) {
    return this.inventory.listBeds(user.tenantId, branchId, roomId);
  }

  @Post('beds')
  @RequirePermission('inventory', 'create')
  createBed(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBedDto,
  ) {
    return this.inventory.createBed(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('beds/:bedId')
  @RequirePermission('inventory', 'edit')
  updateBed(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('bedId', ParseUUIDPipe) bedId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateBedDto,
  ) {
    return this.inventory.updateBed(user.tenantId, branchId, user.userId, bedId, dto);
  }

  @Delete('beds/:bedId')
  @RequirePermission('inventory', 'delete')
  archiveBed(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('bedId', ParseUUIDPipe) bedId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventory.archiveBed(user.tenantId, branchId, user.userId, bedId);
  }
}
