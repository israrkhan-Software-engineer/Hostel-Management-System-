// Mock @prisma/client for unit tests (Prisma binary unavailable in CI sandbox)

export class PrismaClient {
  $connect = jest.fn().mockResolvedValue(undefined);
  $disconnect = jest.fn().mockResolvedValue(undefined);
  $queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
  $queryRawUnsafe = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
  $executeRawUnsafe = jest.fn().mockResolvedValue(1);
  $transaction = jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
}

// Enums — must match schema.prisma exactly
export enum TenantStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE       = 'ACTIVE',
  SUSPENDED    = 'SUSPENDED',
  OFFBOARDING  = 'OFFBOARDING',
  CLOSED       = 'CLOSED',
}

export enum BranchStatus {
  ACTIVE   = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum BedStatus {
  AVAILABLE     = 'AVAILABLE',
  RESERVED      = 'RESERVED',
  OCCUPIED      = 'OCCUPIED',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

export enum ResidentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum AdmissionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
}

export enum InvoiceStatus {
  ISSUED = 'ISSUED',
  VOID = 'VOID',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  MOBILE_WALLET = 'MOBILE_WALLET',
  CARD_MANUAL = 'CARD_MANUAL',
}

export enum MessMealType {
  BREAKFAST = 'BREAKFAST',
  LUNCH = 'LUNCH',
  DINNER = 'DINNER',
}

export enum ComplaintStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum ComplaintPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum NoticeStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum VisitorVisitStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
}

export enum UserStatus {
  ACTIVE      = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

export enum StudentAttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
}

export enum LeaveRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum StudentGatePassStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum MealAttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
}

export enum MealSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  EXPIRED = 'EXPIRED',
}

export enum PlatformAdminStatus {
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

export enum BillingInterval {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum PlatformInvoiceStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  VOID = 'VOID',
}

export enum PlatformPaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CARD = 'CARD',
  OTHER = 'OTHER',
}

export enum DiscountType {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
  SCHOLARSHIP = 'SCHOLARSHIP',
}

export enum LateFeeType {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
}

export enum DepositTransactionType {
  DEPOSIT = 'DEPOSIT',
  ADJUSTMENT = 'ADJUSTMENT',
  REFUND = 'REFUND',
}

export enum PermissionAction {
  view            = 'view',
  create          = 'create',
  edit            = 'edit',
  delete          = 'delete',
  approve         = 'approve',
  export          = 'export',
  print           = 'print',
  assign          = 'assign',
  verify          = 'verify',
  manage_settings = 'manage_settings',
}

export const Prisma = {
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => strings.join(''),
  PrismaClientKnownRequestError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
};
