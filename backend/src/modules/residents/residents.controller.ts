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
  CreateResidentDto,
  UpdateMyResidentProfileDto,
  UpdateResidentDto,
} from './residents.dto';
import { ResidentsService } from './residents.service';

@ApiTags('residents')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId/residents', version: '1' })
export class ResidentsController {
  constructor(private readonly residents: ResidentsService) {}

  @Get()
  @RequirePermission('residents', 'view')
  list(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
  ) {
    return this.residents.list(user.tenantId, branchId, search);
  }

  @Get('me')
  @RequirePermission('residents', 'view')
  getMyResident(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.residents.getMyResident(user.tenantId, branchId, user.userId);
  }

  @Patch('me')
  @RequirePermission('residents', 'view')
  updateMyProfile(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateMyResidentProfileDto,
  ) {
    return this.residents.updateMyProfile(user.tenantId, branchId, user.userId, dto);
  }

  @Post()
  @RequirePermission('residents', 'create')
  create(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateResidentDto,
  ) {
    return this.residents.create(user.tenantId, branchId, user.userId, dto);
  }

  @Get(':residentId')
  @RequirePermission('residents', 'view')
  get(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.residents.get(user.tenantId, branchId, residentId);
  }

  @Post(':residentId/link-account')
  @RequirePermission('residents', 'edit')
  linkAccount(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.residents.linkAccountByEmail(
      user.tenantId,
      branchId,
      user.userId,
      residentId,
    );
  }

  @Patch(':residentId')
  @RequirePermission('residents', 'edit')
  update(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateResidentDto,
  ) {
    return this.residents.update(user.tenantId, branchId, user.userId, residentId, dto);
  }

  @Delete(':residentId')
  @RequirePermission('residents', 'delete')
  deactivate(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.residents.deactivate(user.tenantId, branchId, user.userId, residentId);
  }
}
