import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdmissionStatus,
  BedStatus,
  LeaveRequestStatus,
  MealAttendanceStatus,
  MealSubscriptionStatus,
  MessMealType,
  StudentAttendanceStatus,
  StudentDocumentCategory,
  StudentGatePassStatus,
} from '@prisma/client';
import ExcelJS from 'exceljs';
import { basename } from 'path';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RolesService } from '../roles/roles.service';
import { decryptField, encryptField } from '../../common/utils/field-encryption.util';
import {
  AttendanceQueryDto,
  CreateLeaveRequestDto,
  CreateMealPlanDto,
  CreateMealSubscriptionDto,
  CreateStudentGatePassDto,
  DecideLeaveRequestDto,
  DecideStudentGatePassDto,
  ExportFilterDto,
  MarkAttendanceDto,
  MarkMealAttendanceDto,
  RoomTransferDto,
  UploadStudentDocumentDto,
} from './hostel-services.dto';

const MAX_REPORT_DAYS = 366;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ATTENDANCE_STATUSES = Object.values(StudentAttendanceStatus);
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

type UploadedDocument = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Injectable()
export class HostelServicesService {
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    config: ConfigService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('app.fieldEncryptionKey');
  }

  async listAttendance(tenantId: string, branchId: string, query: AttendanceQueryDto) {
    await this.ensureBranch(tenantId, branchId);
    this.validateDateRange(query.from, query.to);
    const where = {
      tenantId,
      branchId,
      ...(query.residentId ? { residentId: query.residentId } : {}),
      ...(this.dateRange('attendanceDate', query.date, query.from, query.to)),
    };
    const [records, grouped] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where,
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ attendanceDate: 'desc' }, { resident: { lastName: 'asc' } }],
        take: 5000,
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);
    return {
      records,
      summary: this.statusSummary(grouped, ATTENDANCE_STATUSES),
    };
  }

  async listMyAttendance(tenantId: string, branchId: string, userId: string, query: AttendanceQueryDto) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    return this.listAttendance(tenantId, branchId, { ...query, residentId: resident.id });
  }

  async markAttendance(
    tenantId: string,
    branchId: string,
    userId: string,
    dto: MarkAttendanceDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const date = this.dateOnly(dto.date);
    this.validateUniqueResidents(dto.records.map(({ residentId }) => residentId));
    await this.ensureResidents(tenantId, branchId, dto.records.map(({ residentId }) => residentId));
    const records = await this.prisma.$transaction(
      dto.records.map(({ residentId, status, notes }) =>
        this.prisma.attendanceRecord.upsert({
          where: {
            tenantId_branchId_residentId_attendanceDate: {
              tenantId,
              branchId,
              residentId,
              attendanceDate: date,
            },
          },
          create: {
            tenantId,
            branchId,
            residentId,
            attendanceDate: date,
            status,
            notes: notes?.trim() || null,
            markedByUserId: userId,
          },
          update: {
            status,
            notes: notes?.trim() || null,
            markedByUserId: userId,
          },
        }),
      ),
    );
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: 'attendance.mark',
      module: 'attendance',
      outcome: 'success',
      metadata: { date: dto.date.slice(0, 10), recordCount: records.length },
    });
    return { records };
  }

  async listLeaveRequests(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.leaveRequest.findMany({
      where: { tenantId, branchId },
      include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 500,
    });
  }

  async listMyLeaveRequests(tenantId: string, branchId: string, userId: string) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    return this.prisma.leaveRequest.findMany({
      where: { tenantId, branchId, residentId: resident.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async createLeaveRequest(
    tenantId: string,
    branchId: string,
    userId: string,
    dto: CreateLeaveRequestDto,
  ) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    const startDate = this.dateOnly(dto.startDate);
    const endDate = this.dateOnly(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('Leave end date must not precede its start date');
    const request = await this.prisma.leaveRequest.create({
      data: {
        tenantId,
        branchId,
        residentId: resident.id,
        startDate,
        endDate,
        reason: dto.reason.trim(),
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: 'leave_request.create',
      module: 'leave_requests',
      entityType: 'leave_request',
      entityId: request.id,
      outcome: 'success',
    });
    return request;
  }

  async decideLeaveRequest(
    tenantId: string,
    branchId: string,
    userId: string,
    requestId: string,
    dto: DecideLeaveRequestDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const status = dto.status as LeaveRequestStatus;
    const updated = await this.prisma.leaveRequest.updateMany({
      where: { id: requestId, tenantId, branchId, status: LeaveRequestStatus.PENDING },
      data: {
        status,
        decisionByUserId: userId,
        decisionAt: new Date(),
        decisionNote: dto.note?.trim() || null,
      },
    });
    if (updated.count !== 1) throw new NotFoundException('Pending leave request not found in this branch');
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: `leave_request.${status.toLowerCase()}`,
      module: 'leave_requests',
      entityType: 'leave_request',
      entityId: requestId,
      outcome: 'success',
    });
    const request = await this.prisma.leaveRequest.findFirstOrThrow({
      where: { id: requestId, tenantId, branchId },
    });
    await this.notifications?.notifyResident({
      tenantId,
      branchId,
      residentId: request.residentId,
      category: 'leave',
      title: `Leave request ${status.toLowerCase()}`,
      body: `Your leave request has been ${status.toLowerCase()}.${dto.note ? ` ${dto.note.trim()}` : ''}`,
      emailSubject: `Hostel leave request ${status.toLowerCase()}`,
      deduplicationKey: `leave-decision:${request.id}`,
    });
    return request;
  }

  async listGatePasses(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    const passes = await this.prisma.studentGatePass.findMany({
      where: { tenantId, branchId },
      include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ status: 'asc' }, { exitAt: 'desc' }],
      take: 500,
    });
    return passes.map((pass) => ({
      ...pass,
      lateReturn: pass.actualReturnAt
        ? pass.actualReturnAt > pass.expectedReturnAt
        : pass.status === StudentGatePassStatus.APPROVED && pass.expectedReturnAt < new Date(),
    }));
  }

  async listMyGatePasses(tenantId: string, branchId: string, userId: string) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    const passes = await this.prisma.studentGatePass.findMany({
      where: { tenantId, branchId, residentId: resident.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return passes.map((pass) => ({
      ...pass,
      lateReturn: pass.actualReturnAt
        ? pass.actualReturnAt > pass.expectedReturnAt
        : pass.status === StudentGatePassStatus.APPROVED && pass.expectedReturnAt < new Date(),
    }));
  }

  async createGatePass(
    tenantId: string,
    branchId: string,
    userId: string,
    dto: CreateStudentGatePassDto,
  ) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    const exitAt = new Date(dto.exitAt);
    const expectedReturnAt = new Date(dto.expectedReturnAt);
    if (!Number.isFinite(exitAt.getTime()) || !Number.isFinite(expectedReturnAt.getTime())
      || expectedReturnAt <= exitAt || exitAt < new Date()) {
      throw new BadRequestException('Gate pass times must be valid, in the future, and expected return must follow exit');
    }
    const pass = await this.prisma.studentGatePass.create({
      data: {
        tenantId,
        branchId,
        residentId: resident.id,
        exitAt,
        expectedReturnAt,
        reason: dto.reason.trim(),
      },
    });
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: 'gate_pass.create',
      module: 'gate_passes',
      entityType: 'student_gate_pass',
      entityId: pass.id,
      outcome: 'success',
    });
    return pass;
  }

  async decideGatePass(
    tenantId: string,
    branchId: string,
    userId: string,
    passId: string,
    dto: DecideStudentGatePassDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const status = dto.status as StudentGatePassStatus;
    const updated = await this.prisma.studentGatePass.updateMany({
      where: { id: passId, tenantId, branchId, status: StudentGatePassStatus.PENDING },
      data: {
        status,
        decisionByUserId: userId,
        decisionAt: new Date(),
        rejectionReason: status === StudentGatePassStatus.REJECTED
          ? dto.rejectionReason?.trim()
          : null,
      },
    });
    if (updated.count !== 1) throw new NotFoundException('Pending student gate pass not found in this branch');
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: `gate_pass.${status.toLowerCase()}`,
      module: 'gate_passes',
      entityType: 'student_gate_pass',
      entityId: passId,
      outcome: 'success',
    });
    const pass = await this.prisma.studentGatePass.findFirstOrThrow({
      where: { id: passId, tenantId, branchId },
    });
    await this.notifications?.notifyResident({
      tenantId,
      branchId,
      residentId: pass.residentId,
      category: 'gate_pass',
      title: `Gate pass ${status.toLowerCase()}`,
      body: status === StudentGatePassStatus.APPROVED
        ? 'Your student gate pass has been approved.'
        : `Your student gate pass was rejected.${dto.rejectionReason ? ` ${dto.rejectionReason.trim()}` : ''}`,
      emailSubject: `Student gate pass ${status.toLowerCase()}`,
      deduplicationKey: `gate-pass-decision:${pass.id}`,
    });
    return pass;
  }

  async recordGatePassReturn(tenantId: string, branchId: string, userId: string, passId: string) {
    await this.ensureBranch(tenantId, branchId);
    const now = new Date();
    const updated = await this.prisma.studentGatePass.updateMany({
      where: { id: passId, tenantId, branchId, status: StudentGatePassStatus.APPROVED },
      data: {
        status: StudentGatePassStatus.RETURNED,
        actualReturnAt: now,
        returnRecordedByUserId: userId,
      },
    });
    if (updated.count !== 1) throw new NotFoundException('Approved student gate pass not found in this branch');
    return this.prisma.studentGatePass.findFirstOrThrow({
      where: { id: passId, tenantId, branchId },
      include: { resident: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async listMealAttendance(
    tenantId: string,
    branchId: string,
    query: AttendanceQueryDto,
    meal?: MessMealType,
  ) {
    await this.ensureBranch(tenantId, branchId);
    this.validateDateRange(query.from, query.to);
    const where = {
      tenantId,
      branchId,
      ...(query.residentId ? { residentId: query.residentId } : {}),
      ...(meal ? { meal } : {}),
      ...this.dateRange('mealDate', query.date, query.from, query.to),
    };
    const [records, grouped] = await Promise.all([
      this.prisma.mealAttendance.findMany({
        where,
        include: { resident: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ mealDate: 'desc' }, { meal: 'asc' }, { resident: { lastName: 'asc' } }],
        take: 5000,
      }),
      this.prisma.mealAttendance.groupBy({
        by: ['meal', 'status'],
        where,
        _count: { _all: true },
      }),
    ]);
    const summary = Object.fromEntries(
      Object.values(MessMealType).map((mealType) => [mealType, {
        present: grouped.find((row) => row.meal === mealType && row.status === MealAttendanceStatus.PRESENT)?._count._all ?? 0,
        absent: grouped.find((row) => row.meal === mealType && row.status === MealAttendanceStatus.ABSENT)?._count._all ?? 0,
      }]),
    );
    return { records, summary };
  }

  async listMyMealAttendance(
    tenantId: string,
    branchId: string,
    userId: string,
    query: AttendanceQueryDto,
  ) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    return this.listMealAttendance(tenantId, branchId, { ...query, residentId: resident.id }, query.meal);
  }

  async markMealAttendance(
    tenantId: string,
    branchId: string,
    userId: string,
    dto: MarkMealAttendanceDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const mealDate = this.dateOnly(dto.date);
    this.validateUniqueResidents(dto.records.map(({ residentId }) => residentId));
    await this.ensureResidents(tenantId, branchId, dto.records.map(({ residentId }) => residentId));
    const records = await this.prisma.$transaction(
      dto.records.map(({ residentId, status }) =>
        this.prisma.mealAttendance.upsert({
          where: {
            tenantId_branchId_residentId_mealDate_meal: {
              tenantId,
              branchId,
              residentId,
              mealDate,
              meal: dto.meal,
            },
          },
          create: {
            tenantId,
            branchId,
            residentId,
            mealDate,
            meal: dto.meal,
            status,
            markedByUserId: userId,
          },
          update: { status, markedByUserId: userId },
        }),
      ),
    );
    return { records };
  }

  async listMealPlans(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.mealSubscriptionPlan.findMany({
      where: { tenantId, branchId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createMealPlan(tenantId: string, branchId: string, userId: string, dto: CreateMealPlanDto) {
    await this.ensureBranch(tenantId, branchId);
    if (new Set(dto.mealTypes).size !== dto.mealTypes.length) {
      throw new BadRequestException('Meal types must not be repeated');
    }
    return this.prisma.mealSubscriptionPlan.create({
      data: {
        tenantId,
        branchId,
        name: dto.name.trim(),
        monthlyAmountMinor: dto.monthlyAmountMinor,
        mealTypes: dto.mealTypes,
        createdByUserId: userId,
      },
    });
  }

  async setMealPlanActive(tenantId: string, branchId: string, planId: string, isActive: boolean) {
    await this.ensureBranch(tenantId, branchId);
    const updated = await this.prisma.mealSubscriptionPlan.updateMany({
      where: { id: planId, tenantId, branchId },
      data: { isActive },
    });
    if (updated.count !== 1) throw new NotFoundException('Meal plan not found in this branch');
    return this.prisma.mealSubscriptionPlan.findFirstOrThrow({
      where: { id: planId, tenantId, branchId },
    });
  }

  async listMealSubscriptions(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    await this.expireMealSubscriptions(tenantId, branchId);
    return this.prisma.mealSubscription.findMany({
      where: { tenantId, branchId },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true } },
        plan: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
  }

  async listMyMealSubscriptions(tenantId: string, branchId: string, userId: string) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    await this.expireMealSubscriptions(tenantId, branchId);
    return this.prisma.mealSubscription.findMany({
      where: { tenantId, branchId, residentId: resident.id },
      include: { plan: true },
      orderBy: { startsOn: 'desc' },
      take: 100,
    });
  }

  async activateMealSubscription(
    tenantId: string,
    branchId: string,
    userId: string,
    residentId: string,
    dto: CreateMealSubscriptionDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    await this.ensureResidents(tenantId, branchId, [residentId]);
    const startsOn = this.dateOnly(dto.startsOn);
    const endsOn = this.dateOnly(dto.endsOn);
    if (endsOn < startsOn) throw new BadRequestException('Subscription end date must not precede its start date');
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.mealSubscriptionPlan.findFirst({
        where: { id: dto.planId, tenantId, branchId, isActive: true },
        select: { id: true },
      });
      if (!plan) throw new NotFoundException('Active meal plan not found in this branch');
      const current = await tx.mealSubscription.findFirst({
        where: { tenantId, branchId, residentId, status: MealSubscriptionStatus.ACTIVE },
        select: { id: true, startsOn: true, endsOn: true },
      });
      if (current) {
        if (current.endsOn >= startsOn) {
          throw new ConflictException('This resident already has an active subscription covering those dates');
        }
        await tx.mealSubscription.update({
          where: { id: current.id },
          data: { status: MealSubscriptionStatus.EXPIRED, deactivatedAt: current.endsOn },
        });
      }
      return tx.mealSubscription.create({
        data: {
          tenantId,
          branchId,
          residentId,
          planId: plan.id,
          startsOn,
          endsOn,
          activatedByUserId: userId,
        },
        include: { resident: { select: { id: true, firstName: true, lastName: true } }, plan: true },
      });
    });
  }

  async deactivateMealSubscription(tenantId: string, branchId: string, subscriptionId: string) {
    await this.ensureBranch(tenantId, branchId);
    const result = await this.prisma.mealSubscription.updateMany({
      where: { id: subscriptionId, tenantId, branchId, status: MealSubscriptionStatus.ACTIVE },
      data: { status: MealSubscriptionStatus.INACTIVE, deactivatedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException('Active meal subscription not found in this branch');
    return this.prisma.mealSubscription.findFirstOrThrow({
      where: { id: subscriptionId, tenantId, branchId },
      include: { plan: true },
    });
  }

  async listResidentDocuments(tenantId: string, branchId: string, residentId: string) {
    await this.ensureResidents(tenantId, branchId, [residentId]);
    return this.prisma.studentDocument.findMany({
      where: { tenantId, branchId, residentId },
      select: {
        id: true,
        category: true,
        originalName: true,
        mimeType: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listMyDocuments(tenantId: string, branchId: string, userId: string) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    return this.listResidentDocuments(tenantId, branchId, resident.id);
  }

  async getMyResidentId(tenantId: string, branchId: string, userId: string) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    return resident.id;
  }

  async uploadResidentDocument(
    tenantId: string,
    branchId: string,
    userId: string,
    residentId: string,
    dto: UploadStudentDocumentDto,
    file: UploadedDocument | undefined,
    replaceId?: string,
  ) {
    await this.ensureResidents(tenantId, branchId, [residentId]);
    const validated = this.validateDocument(file);
    const data = {
      category: dto.category,
      originalName: validated.originalName,
      mimeType: validated.mimetype,
      fileData: Buffer.from(
        encryptField(validated.buffer.toString('base64'), this.encryptionKey),
        'utf8',
      ),
      updatedAt: new Date(),
    };
    if (replaceId) {
      const updated = await this.prisma.studentDocument.updateMany({
        where: { id: replaceId, tenantId, branchId, residentId },
        data,
      });
      if (updated.count !== 1) throw new NotFoundException('Document not found for this resident');
      return this.prisma.studentDocument.findFirstOrThrow({
        where: { id: replaceId, tenantId, branchId, residentId },
        select: { id: true, category: true, originalName: true, mimeType: true, createdAt: true, updatedAt: true },
      });
    }
    return this.prisma.studentDocument.create({
      data: {
        tenantId,
        branchId,
        residentId,
        uploadedByUserId: userId,
        ...data,
      },
      select: { id: true, category: true, originalName: true, mimeType: true, createdAt: true, updatedAt: true },
    });
  }

  async downloadResidentDocument(
    tenantId: string,
    branchId: string,
    documentId: string,
    residentId?: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const document = await this.prisma.studentDocument.findFirst({
      where: { id: documentId, tenantId, branchId, ...(residentId ? { residentId } : {}) },
      select: { id: true, originalName: true, mimeType: true, fileData: true },
    });
    if (!document) throw new NotFoundException('Document not found in this branch');
    return {
      buffer: this.decryptDocument(document.fileData),
      filename: document.originalName,
      mimeType: document.mimeType,
    };
  }

  async downloadMyDocument(
    tenantId: string,
    branchId: string,
    userId: string,
    documentId: string,
  ) {
    const resident = await this.getMyResident(tenantId, branchId, userId);
    const document = await this.prisma.studentDocument.findFirst({
      where: { id: documentId, tenantId, branchId, residentId: resident.id },
      select: { originalName: true, mimeType: true, fileData: true },
    });
    if (!document) throw new NotFoundException('Document not found for this resident');
    return {
      buffer: this.decryptDocument(document.fileData),
      filename: document.originalName,
      mimeType: document.mimeType,
    };
  }

  async deleteResidentDocument(
    tenantId: string,
    branchId: string,
    documentId: string,
    residentId?: string,
  ) {
    await this.ensureBranch(tenantId, branchId);
    const result = await this.prisma.studentDocument.deleteMany({
      where: { id: documentId, tenantId, branchId, ...(residentId ? { residentId } : {}) },
    });
    if (result.count !== 1) throw new NotFoundException('Document not found in this branch');
    return { deleted: true };
  }

  async listAvailableBeds(tenantId: string, branchId: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.bed.findMany({
      where: { tenantId, branchId, deletedAt: null, status: BedStatus.AVAILABLE },
      include: {
        room: {
          select: {
            id: true,
            code: true,
            floor: { select: { name: true, level: true, building: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ room: { code: 'asc' } }, { code: 'asc' }],
      take: 1000,
    });
  }

  async transferResidentRoom(
    tenantId: string,
    branchId: string,
    userId: string,
    residentId: string,
    dto: RoomTransferDto,
  ) {
    await this.ensureBranch(tenantId, branchId);
    let transferId = '';
    try {
      transferId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM bed_allocations
          WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND resident_id = ${residentId}::uuid AND ended_at IS NULL
          FOR UPDATE
        `;
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM beds
          WHERE id = ${dto.toBedId}::uuid AND tenant_id = ${tenantId}::uuid
            AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
          FOR UPDATE
        `;
        const [resident, current, destination] = await Promise.all([
          tx.resident.findFirst({
            where: { id: residentId, tenantId, branchId, status: 'ACTIVE', deletedAt: null },
            select: { id: true },
          }),
          tx.bedAllocation.findFirst({
            where: {
              tenantId,
              branchId,
              residentId,
              endedAt: null,
              status: { in: ['RESERVED', 'CHECKED_IN'] },
            },
            include: {
              admission: { select: { status: true } },
              bed: { select: { id: true, code: true, room: { select: { code: true } } } },
            },
          }),
          tx.bed.findFirst({
            where: { id: dto.toBedId, tenantId, branchId, deletedAt: null },
            include: { room: { select: { code: true } } },
          }),
        ]);
        if (!resident) throw new NotFoundException('Resident not found in this branch');
        if (!current || current.admission.status !== AdmissionStatus.CHECKED_IN) {
          throw new ConflictException('Resident must have an active checked-in bed allocation before transfer');
        }
        if (!destination) throw new NotFoundException('Destination bed not found in this branch');
        if (destination.id === current.bedId) throw new BadRequestException('Resident is already assigned to this bed');
        if (destination.status !== BedStatus.AVAILABLE) {
          throw new ConflictException('Destination bed is not available');
        }
        const now = new Date();
        await tx.bedAllocation.update({
          where: { id: current.id },
          data: { status: 'ENDED', endedAt: now },
        });
        await tx.bed.update({
          where: { id: current.bedId },
          data: { status: BedStatus.AVAILABLE },
        });
        await tx.bed.update({
          where: { id: destination.id },
          data: { status: BedStatus.OCCUPIED },
        });
        const nextAllocation = await tx.bedAllocation.create({
          data: {
            tenantId,
            branchId,
            admissionId: current.admissionId,
            residentId,
            bedId: destination.id,
            status: 'CHECKED_IN',
            allocatedAt: now,
            checkedInAt: now,
          },
        });
        const transfer = await tx.roomTransfer.create({
          data: {
            tenantId,
            branchId,
            residentId,
            fromBedId: current.bedId,
            fromRoomCode: current.bed.room.code,
            fromBedCode: current.bed.code,
            toBedId: destination.id,
            toRoomCode: destination.room.code,
            toBedCode: destination.code,
            previousAllocationId: current.id,
            newAllocationId: nextAllocation.id,
            reason: dto.reason.trim(),
            transferredByUserId: userId,
          },
        });
        return transfer.id;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (this.isPrismaConflict(error)) {
        throw new ConflictException('Destination bed or resident allocation changed during transfer; reload and try again');
      }
      throw error;
    }
    await this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: 'room_transfer.create',
      module: 'allocations',
      entityType: 'room_transfer',
      entityId: transferId,
      outcome: 'success',
    });
    return this.prisma.roomTransfer.findFirstOrThrow({ where: { id: transferId, tenantId, branchId } });
  }

  async listRoomTransfers(tenantId: string, branchId: string, residentId?: string) {
    await this.ensureBranch(tenantId, branchId);
    return this.prisma.roomTransfer.findMany({
      where: {
        tenantId,
        branchId,
        ...(residentId ? { residentId } : {}),
      },
      include: { resident: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { transferredAt: 'desc' },
      take: 1000,
    });
  }

  async exportWorkbook(
    tenantId: string,
    branchId: string,
    userId: string,
    dataset: 'residents' | 'admissions' | 'attendance' | 'finance',
    filter: ExportFilterDto,
  ) {
    this.validateDateRange(filter.from, filter.to);
    const required = dataset === 'residents'
      ? [['residents', 'view']]
      : dataset === 'admissions'
        ? [['admissions', 'view']]
        : dataset === 'attendance'
          ? [['attendance', 'view']]
          : [['invoices', 'view'], ['reports', 'view']];
    await this.prisma.runWithTenantContext(tenantId, async () => {
      await this.ensureBranch(tenantId, branchId);
      const allowed = await Promise.all(required.map(([module, action]) =>
        this.roles.userHasPermission(userId, tenantId, module, action as 'view'),
      ));
      if (!allowed.some(Boolean)) {
        throw new ForbiddenException(`You do not have permission to export ${dataset} records`);
      }
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Hostel Management System';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(dataset);
    if (dataset === 'residents') {
      sheet.columns = [
        { header: 'Resident ID', key: 'id', width: 38 },
        { header: 'First name', key: 'firstName', width: 24 },
        { header: 'Last name', key: 'lastName', width: 24 },
        { header: 'Email', key: 'email', width: 32 },
        { header: 'Phone', key: 'phone', width: 20 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Created at', key: 'createdAt', width: 24 },
      ];
      const rows = await this.prisma.runWithTenantContext(tenantId, () => this.prisma.resident.findMany({
        where: {
          tenantId,
          branchId,
          deletedAt: null,
          ...this.timestampRange(filter.from, filter.to),
        },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, createdAt: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 10001,
      }));
      this.ensureExportSize(rows.length);
      sheet.addRows(rows);
    } else if (dataset === 'admissions') {
      sheet.columns = [
        { header: 'Admission ID', key: 'id', width: 38 },
        { header: 'Resident', key: 'resident', width: 36 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Requested check-in', key: 'requestedCheckInAt', width: 24 },
        { header: 'Checked in', key: 'checkedInAt', width: 24 },
        { header: 'Checked out', key: 'checkedOutAt', width: 24 },
        { header: 'Created at', key: 'createdAt', width: 24 },
      ];
      const rows = await this.prisma.runWithTenantContext(tenantId, () => this.prisma.admission.findMany({
        where: {
          tenantId,
          branchId,
          deletedAt: null,
          ...this.timestampRange(filter.from, filter.to),
        },
        include: { resident: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10001,
      }));
      this.ensureExportSize(rows.length);
      sheet.addRows(rows.map((row) => ({
        id: row.id,
        resident: `${row.resident.firstName} ${row.resident.lastName}`,
        status: row.status,
        requestedCheckInAt: row.requestedCheckInAt,
        checkedInAt: row.checkedInAt,
        checkedOutAt: row.checkedOutAt,
        createdAt: row.createdAt,
      })));
    } else if (dataset === 'attendance') {
      sheet.columns = [
        { header: 'Date', key: 'attendanceDate', width: 16 },
        { header: 'Resident', key: 'resident', width: 36 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Notes', key: 'notes', width: 50 },
        { header: 'Marked at', key: 'updatedAt', width: 24 },
      ];
      const rows = await this.prisma.runWithTenantContext(tenantId, () => this.prisma.attendanceRecord.findMany({
        where: { tenantId, branchId, ...this.dateRange('attendanceDate', undefined, filter.from, filter.to) },
        include: { resident: { select: { firstName: true, lastName: true } } },
        orderBy: [{ attendanceDate: 'desc' }, { resident: { lastName: 'asc' } }],
        take: 10001,
      }));
      this.ensureExportSize(rows.length);
      sheet.addRows(rows.map((row) => ({
        attendanceDate: row.attendanceDate,
        resident: `${row.resident.firstName} ${row.resident.lastName}`,
        status: row.status,
        notes: row.notes,
        updatedAt: row.updatedAt,
      })));
    } else {
      sheet.columns = [
        { header: 'Invoice number', key: 'invoiceNumber', width: 24 },
        { header: 'Resident', key: 'resident', width: 36 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Currency', key: 'currency', width: 12 },
        { header: 'Total minor units', key: 'total', width: 20 },
        { header: 'Verified payments minor units', key: 'paid', width: 30 },
        { header: 'Issued at', key: 'issuedAt', width: 24 },
        { header: 'Due at', key: 'dueAt', width: 24 },
      ];
      const rows = await this.prisma.runWithTenantContext(tenantId, () => this.prisma.invoice.findMany({
        where: {
          tenantId,
          branchId,
          deletedAt: null,
          ...this.timestampRange(filter.from, filter.to, 'issuedAt'),
        },
        include: {
          resident: { select: { firstName: true, lastName: true } },
          lines: { select: { lineAmountMinor: true } },
          payments: { where: { status: 'VERIFIED' }, select: { amountMinor: true } },
        },
        orderBy: { issuedAt: 'desc' },
        take: 10001,
      }));
      this.ensureExportSize(rows.length);
      sheet.addRows(rows.map((row) => ({
        invoiceNumber: row.invoiceNumber,
        resident: `${row.resident.firstName} ${row.resident.lastName}`,
        status: row.status,
        currency: row.currency,
        total: row.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0),
        paid: row.payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
        issuedAt: row.issuedAt,
        dueAt: row.dueAt,
      })));
    }
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    await this.prisma.runWithTenantContext(tenantId, () => this.audit.log({
      tenantId,
      branchId,
      actorUserId: userId,
      action: `records.export.${dataset}`,
      module: 'exports',
      outcome: 'success',
      metadata: { dataset, rowCount: sheet.rowCount - 1 },
    }));
    const content = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(content),
      filename: `${dataset}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private async getMyResident(tenantId: string, branchId: string, userId: string) {
    await this.ensureBranch(tenantId, branchId);
    const resident = await this.prisma.resident.findFirst({
      where: { tenantId, branchId, userId, status: 'ACTIVE', deletedAt: null },
    });
    if (!resident) throw new NotFoundException('Student account is not linked to an active resident in this branch');
    return resident;
  }

  private async ensureResidents(tenantId: string, branchId: string, residentIds: string[]) {
    const residents = await this.prisma.resident.findMany({
      where: { id: { in: residentIds }, tenantId, branchId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (residents.length !== new Set(residentIds).size) {
      throw new NotFoundException('One or more active residents were not found in this branch');
    }
  }

  private async ensureBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found or inactive');
  }

  private async expireMealSubscriptions(tenantId: string, branchId: string) {
    const today = this.dateOnly(new Date().toISOString());
    await this.prisma.mealSubscription.updateMany({
      where: {
        tenantId,
        branchId,
        status: MealSubscriptionStatus.ACTIVE,
        endsOn: { lt: today },
      },
      data: { status: MealSubscriptionStatus.EXPIRED },
    });
  }

  private ensureExportSize(rowCount: number) {
    if (rowCount > 10000) {
      throw new BadRequestException('Export exceeds 10,000 rows. Narrow the date range before downloading.');
    }
  }

  private validateUniqueResidents(residentIds: string[]) {
    if (new Set(residentIds).size !== residentIds.length) {
      throw new BadRequestException('A resident can only appear once in a batch');
    }
  }

  private dateOnly(value: string) {
    const datePart = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      throw new BadRequestException('Date must use the YYYY-MM-DD format');
    }
    const date = new Date(`${datePart}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== datePart) {
      throw new BadRequestException('A valid calendar date is required');
    }
    return date;
  }

  private validateDateRange(from?: string, to?: string) {
    if (Boolean(from) !== Boolean(to)) {
      throw new BadRequestException('Both from and to dates are required for a date range');
    }
    if (!from || !to) return;
    const start = this.dateOnly(from);
    const end = this.dateOnly(to);
    const rangeDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (rangeDays < 0 || rangeDays > MAX_REPORT_DAYS) {
      throw new BadRequestException(`Date range must be ordered and no longer than ${MAX_REPORT_DAYS} days`);
    }
  }

  private dateRange(field: 'attendanceDate' | 'mealDate', date?: string, from?: string, to?: string) {
    if (date) {
      const day = this.dateOnly(date);
      return { [field]: day };
    }
    if (from && to) {
      return { [field]: { gte: this.dateOnly(from), lte: this.dateOnly(to) } };
    }
    return {};
  }

  private timestampRange(from?: string, to?: string, field: 'createdAt' | 'issuedAt' = 'createdAt') {
    if (!from || !to) return {};
    const end = this.dateOnly(to);
    end.setUTCHours(23, 59, 59, 999);
    return {
      [field]: { gte: this.dateOnly(from), lte: end },
    };
  }

  private statusSummary<T extends string>(
    grouped: Array<{ status: T; _count: { _all: number } }>,
    statuses: readonly T[],
  ) {
    const counts = Object.fromEntries(statuses.map((status) => [
      status,
      grouped.find((row) => row.status === status)?._count._all ?? 0,
    ]));
    return {
      counts,
      total: Object.values(counts).reduce((sum, count) => sum + Number(count), 0),
    };
  }

  private validateDocument(file?: UploadedDocument) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length
      || file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Choose a document between 1 byte and 10 MB');
    }
    if (!DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF, JPEG, and PNG documents are allowed');
    }
    const validSignature = file.mimetype === 'application/pdf'
      ? file.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
      : file.mimetype === 'image/jpeg'
        ? file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff
        : file.buffer.length >= 8
          && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validSignature) throw new BadRequestException('The uploaded file does not match its declared type');
    const fileName = basename(file.originalname.split(/[\\/]/).pop() ?? '')
      .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_')
      .slice(0, 180);
    if (!fileName) throw new BadRequestException('A valid document filename is required');
    return { buffer: file.buffer, mimetype: file.mimetype, originalName: fileName };
  }

  private decryptDocument(data: Uint8Array) {
    const encrypted = Buffer.from(data).toString('utf8');
    return Buffer.from(decryptField(encrypted, this.encryptionKey), 'base64');
  }

  private isPrismaConflict(error: unknown) {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error.code === 'P2002' || error.code === 'P2034');
  }
}
