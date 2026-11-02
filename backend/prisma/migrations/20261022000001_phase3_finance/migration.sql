-- Phase 3: branch-scoped invoices, manually recorded payments, and refunds.
-- Amounts are integer minor units in the invoice's currency.

CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'VOID');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_WALLET', 'CARD_MANUAL');

CREATE TABLE invoices (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  resident_id         UUID NOT NULL REFERENCES residents(id),
  invoice_number      TEXT NOT NULL,
  currency            TEXT NOT NULL,
  status              "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at              TIMESTAMPTZ,
  notes               TEXT,
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT uq_invoices_tenant_number UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX idx_invoices_tenant_branch_status
  ON invoices (tenant_id, branch_id, status, issued_at DESC);
CREATE INDEX idx_invoices_tenant_resident
  ON invoices (tenant_id, resident_id, issued_at DESC);

CREATE TABLE invoice_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  description         TEXT NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_minor   INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  line_amount_minor   INTEGER NOT NULL CHECK (line_amount_minor > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_invoice_line_amount
    CHECK (line_amount_minor::BIGINT = quantity::BIGINT * unit_amount_minor::BIGINT)
);

CREATE INDEX idx_invoice_lines_tenant_branch_invoice
  ON invoice_lines (tenant_id, branch_id, invoice_id);

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  amount_minor        INTEGER NOT NULL CHECK (amount_minor > 0),
  method              "PaymentMethod" NOT NULL,
  status              "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  reference           TEXT,
  proof_notes         TEXT,
  rejection_reason    TEXT,
  recorded_by_user_id UUID NOT NULL REFERENCES users(id),
  verified_by_user_id UUID REFERENCES users(id),
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payment_verification_state CHECK (
    (status = 'VERIFIED' AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)
    OR status <> 'VERIFIED'
  )
);

CREATE INDEX idx_payments_tenant_branch_invoice_status
  ON payments (tenant_id, branch_id, invoice_id, status);
CREATE INDEX idx_payments_tenant_branch_created
  ON payments (tenant_id, branch_id, created_at DESC);

CREATE TABLE refunds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  amount_minor        INTEGER NOT NULL CHECK (amount_minor > 0),
  method              "PaymentMethod" NOT NULL,
  reference           TEXT,
  notes               TEXT,
  recorded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_tenant_branch_invoice_created
  ON refunds (tenant_id, branch_id, invoice_id, created_at DESC);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoices ON invoices
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoice_lines ON invoice_lines
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payments ON payments
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refunds ON refunds
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);
