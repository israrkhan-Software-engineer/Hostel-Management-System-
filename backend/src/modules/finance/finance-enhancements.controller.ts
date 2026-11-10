import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  AssignFeeDto,
  CreateFeeInvoiceDto,
  CreateDepositTransactionDto,
  CreateFeeStructureDto,
  CreateLateFeeSettingDto,
  CreateStudentDiscountDto,
} from './finance-enhancements.dto';
import { FinanceEnhancementsService } from './finance-enhancements.service';

@ApiTags('finance')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId', version: '1' })
export class FinanceEnhancementsController {
  constructor(private readonly finance: FinanceEnhancementsService) {}

  @Get('fee-structures')
  @RequirePermission('invoices', 'view')
  listFeeStructures(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.listFeeStructures(user.tenantId, branchId);
  }

  @Post('fee-structures')
  @RequirePermission('invoices', 'manage_settings')
  createFeeStructure(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFeeStructureDto,
  ) {
    return this.finance.createFeeStructure(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('fee-structures/:feeStructureId/deactivate')
  @RequirePermission('invoices', 'manage_settings')
  deactivateFeeStructure(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.deactivateFeeStructure(user.tenantId, branchId, user.userId, feeStructureId);
  }

  @Post('fee-structures/:feeStructureId/assignments')
  @RequirePermission('invoices', 'assign')
  assignFee(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AssignFeeDto,
  ) {
    return this.finance.assignFee(user.tenantId, branchId, user.userId, feeStructureId, dto);
  }

  @Get('residents/:residentId/fee-history')
  @RequirePermission('invoices', 'view')
  feeHistory(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.listFeeHistory(user.tenantId, branchId, residentId);
  }

  @Post('fee-assignments/:assignmentId/invoices')
  @RequirePermission('invoices', 'create')
  createInvoiceFromFee(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFeeInvoiceDto,
  ) {
    return this.finance.createInvoiceFromFee(
      user.tenantId,
      branchId,
      user.userId,
      assignmentId,
      dto.dueAt,
    );
  }

  @Get('late-fee-settings')
  @RequirePermission('invoices', 'view')
  listLateFeeSettings(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.listLateFeeSettings(user.tenantId, branchId);
  }

  @Post('late-fee-settings')
  @RequirePermission('invoices', 'manage_settings')
  createLateFeeSetting(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLateFeeSettingDto,
  ) {
    return this.finance.createLateFeeSetting(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('late-fee-settings/:settingId/deactivate')
  @RequirePermission('invoices', 'manage_settings')
  deactivateLateFeeSetting(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('settingId', ParseUUIDPipe) settingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.deactivateLateFeeSetting(user.tenantId, branchId, user.userId, settingId);
  }

  @Post('late-fees/apply')
  @RequirePermission('invoices', 'edit')
  applyLateFees(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.applyLateFees(user.tenantId, branchId, user.userId);
  }

  @Get('late-fee-history')
  @RequirePermission('invoices', 'view')
  lateFeeHistory(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query('invoiceId', new ParseUUIDPipe({ optional: true })) invoiceId?: string,
  ) {
    return this.finance.listLateFeeHistory(user.tenantId, branchId, invoiceId);
  }

  @Get('discounts')
  @RequirePermission('invoices', 'view')
  listDiscounts(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query('residentId', new ParseUUIDPipe({ optional: true })) residentId?: string,
  ) {
    return this.finance.listDiscounts(user.tenantId, branchId, residentId);
  }

  @Post('discounts')
  @RequirePermission('invoices', 'create')
  createDiscount(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateStudentDiscountDto,
  ) {
    return this.finance.createDiscount(user.tenantId, branchId, user.userId, dto);
  }

  @Patch('discounts/:discountId/approve')
  @RequirePermission('invoices', 'approve')
  approveDiscount(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('discountId', ParseUUIDPipe) discountId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.approveDiscount(user.tenantId, branchId, user.userId, discountId);
  }

  @Post('security-deposits/transactions')
  @RequirePermission('payments', 'approve')
  createDepositTransaction(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateDepositTransactionDto,
  ) {
    return this.finance.createDepositTransaction(user.tenantId, branchId, user.userId, dto);
  }

  @Get('residents/:residentId/security-deposit')
  @RequirePermission('payments', 'approve')
  depositBalance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.getDepositBalance(user.tenantId, branchId, residentId);
  }

  @Get('resident/security-deposit')
  @RequirePermission('payments', 'view')
  myDepositBalance(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.getMyDepositBalance(user.tenantId, branchId, user.userId);
  }
}
