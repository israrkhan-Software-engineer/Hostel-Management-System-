export type StudentPayment = {
  id: string;
  amountMinor: number;
  method: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  reference: string | null;
  proofNotes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  proofFileName: string | null;
  proofAvailable: boolean;
};

export type StudentInvoice = {
  id: string;
  invoiceNumber: string;
  currency: string;
  status: string;
  issuedAt: string;
  dueAt: string | null;
  lines: Array<{ id: string; description: string; lineAmountMinor: number }>;
  payments: StudentPayment[];
  invoiceTotalMinor: number;
  verifiedPaymentsMinor: number;
  refundedMinor: number;
  balanceDueMinor: number;
};
