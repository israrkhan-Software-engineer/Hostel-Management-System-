import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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

  @Post('floors')
  @RequirePermission('inventory', 'create')
  createFloor(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFloorDto,
  ) {
    return this.inventory.createFloor(user.tenantId, branchId, user.userId, dto);
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
}
