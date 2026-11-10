import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped } from '../../common/decorators/branch-scoped.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SkipTenantTransaction } from '../../common/decorators/skip-tenant-transaction.decorator';
import {
  CreateInvoiceDto,
  FinanceReportFilterDto,
  InvoiceFilterDto,
  RecordPaymentDto,
  RecordRefundDto,
  ReviewPaymentDto,
  SubmitResidentPaymentDto,
  UploadedPaymentProof,
} from './finance.dto';
import { FinanceService } from './finance.service';

@ApiTags('finance')
@ApiBearerAuth()
@BranchScoped()
@Controller({ path: 'branches/:branchId', version: '1' })
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('finance-report')
  @RequirePermission('reports', 'view')
  financeReport(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: FinanceReportFilterDto,
  ) {
    return this.finance.getReport(user.tenantId, branchId, filter);
  }

  @Get('invoices')
  @RequirePermission('invoices', 'view')
  listInvoices(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Query() filter: InvoiceFilterDto,
  ) {
    return this.finance.listInvoices(user.tenantId, branchId, filter.status);
  }

  @Get('resident/finance')
  @RequirePermission('invoices', 'view')
  listResidentInvoices(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.listResidentInvoices(user.tenantId, branchId, user.userId);
  }

  @Post('resident/invoices/:invoiceId/payments')
  @RequirePermission('payments', 'create')
  @SkipTenantTransaction()
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  submitResidentPayment(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SubmitResidentPaymentDto,
    @UploadedFile() file: UploadedPaymentProof,
  ) {
    return this.finance.submitResidentPayment(
      user.tenantId,
      branchId,
      user.userId,
      invoiceId,
      dto,
      file,
    );
  }

  @Get('resident/payments/:paymentId/proof')
  @RequirePermission('payment_proofs', 'view')
  @SkipTenantTransaction()
  async downloadResidentPaymentProof(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const proof = await this.finance.getResidentPaymentProof(
      user.tenantId,
      branchId,
      user.userId,
      paymentId,
    );
    return this.streamProof(proof);
  }

  @Post('invoices')
  @RequirePermission('invoices', 'create')
  createInvoice(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.finance.createInvoice(user.tenantId, branchId, user.userId, dto);
  }

  @Get('invoices/:invoiceId')
  @RequirePermission('invoices', 'view')
  getInvoice(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.getInvoice(user.tenantId, branchId, invoiceId);
  }

  @Get('invoices/:invoiceId/pdf')
  @RequirePermission('invoices', 'view')
  @SkipTenantTransaction()
  async downloadInvoicePdf(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const pdf = await this.finance.generateInvoicePdf(user.tenantId, branchId, invoiceId);
    const filename = `${pdf.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    return new StreamableFile(pdf.buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Patch('invoices/:invoiceId/void')
  @RequirePermission('invoices', 'edit')
  voidInvoice(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.finance.voidInvoice(user.tenantId, branchId, user.userId, invoiceId);
  }

  @Post('invoices/:invoiceId/payments')
  @RequirePermission('payments', 'create')
  recordPayment(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.finance.recordPayment(user.tenantId, branchId, user.userId, invoiceId, dto);
  }

  @Patch('payments/:paymentId/review')
  @RequirePermission('payments', 'verify')
  reviewPayment(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ReviewPaymentDto,
  ) {
    return this.finance.reviewPayment(user.tenantId, branchId, user.userId, paymentId, dto);
  }

  @Get('payments/:paymentId/proof')
  @RequirePermission('payment_proofs', 'view')
  @SkipTenantTransaction()
  async downloadPaymentProof(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const proof = await this.finance.getPaymentProof(user.tenantId, branchId, paymentId);
    return this.streamProof(proof);
  }

  @Post('invoices/:invoiceId/refunds')
  @RequirePermission('payments', 'approve')
  recordRefund(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordRefundDto,
  ) {
    return this.finance.recordRefund(user.tenantId, branchId, user.userId, invoiceId, dto);
  }

  private streamProof(proof: {
    proofData: Uint8Array | null;
    proofFileName: string | null;
    proofMimeType: string | null;
  }) {
    if (!proof.proofData || !proof.proofFileName || !proof.proofMimeType) {
      throw new Error('Payment proof metadata was unavailable after validation.');
    }
    const filename = proof.proofFileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return new StreamableFile(Buffer.from(proof.proofData), {
      type: proof.proofMimeType,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
