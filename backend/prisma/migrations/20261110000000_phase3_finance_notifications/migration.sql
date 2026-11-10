CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "DiscountType" AS ENUM ('FIXED', 'PERCENTAGE', 'SCHOLARSHIP');
CREATE TYPE "LateFeeType" AS ENUM ('FIXED', 'PERCENTAGE');
CREATE TYPE "DepositTransactionType" AS ENUM ('DEPOSIT', 'ADJUSTMENT', 'REFUND');

INSERT INTO permissions (id, module, action)
VALUES
  (gen_random_uuid(), 'notifications', 'view'),
  (gen_random_uuid(), 'invoices', 'assign'),
  (gen_random_uuid(), 'invoices', 'approve'),
  (gen_random_uuid(), 'invoices', 'manage_settings')
ON CONFLICT (module, action) DO NOTHING;

CREATE TABLE fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category TEXT CHECK (category IS NULL OR length(category) <= 80),
  interval "BillingInterval" NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fee_structures_branch_active ON fee_structures (tenant_id, branch_id, is_active);

CREATE TABLE fee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  fee_structure_id UUID NOT NULL REFERENCES fee_structures(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  interval "BillingInterval" NOT NULL,
  starts_at DATE NOT NULL,
  ends_at DATE,
  assigned_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX idx_fee_assignments_resident_history
  ON fee_assignments (tenant_id, branch_id, resident_id, starts_at DESC);
ALTER TABLE invoices ADD COLUMN fee_assignment_id UUID UNIQUE REFERENCES fee_assignments(id);

CREATE TABLE late_fee_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  days_after_due INTEGER NOT NULL CHECK (days_after_due BETWEEN 1 AND 365),
  fee_type "LateFeeType" NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (fee_type <> 'PERCENTAGE' OR amount <= 10000)
);
CREATE INDEX idx_late_fee_settings_branch_active
  ON late_fee_settings (tenant_id, branch_id, is_active, days_after_due);

CREATE TABLE late_fee_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  setting_id UUID NOT NULL REFERENCES late_fee_settings(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by_user_id UUID NOT NULL REFERENCES users(id),
  CONSTRAINT uq_late_fee_once_per_setting UNIQUE (tenant_id, branch_id, invoice_id, setting_id)
);
CREATE INDEX idx_late_fee_history_invoice
  ON late_fee_history (tenant_id, branch_id, invoice_id);

CREATE TABLE student_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  type "DiscountType" NOT NULL,
  value INTEGER NOT NULL CHECK (value > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  starts_at DATE NOT NULL,
  ends_at DATE,
  approved_at TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES users(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CHECK (type <> 'PERCENTAGE' OR value <= 10000),
  CHECK ((approved_at IS NULL) = (approved_by_user_id IS NULL))
);
CREATE INDEX idx_student_discounts_resident
  ON student_discounts (tenant_id, branch_id, resident_id, starts_at);

CREATE TABLE security_deposit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  type "DepositTransactionType" NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 200),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  submission_key UUID NOT NULL,
  recorded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (type = 'ADJUSTMENT' OR amount_minor > 0),
  CONSTRAINT uq_security_deposit_submission UNIQUE (tenant_id, branch_id, resident_id, submission_key)
);
CREATE INDEX idx_security_deposits_resident
  ON security_deposit_transactions (tenant_id, branch_id, resident_id, created_at DESC);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID REFERENCES branches(id),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
  deduplication_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notifications_dedup UNIQUE (tenant_id, deduplication_key)
);
CREATE INDEX idx_notifications_user_unread
  ON notifications (tenant_id, user_id, read_at, created_at DESC);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
  in_app BOOLEAN NOT NULL DEFAULT TRUE,
  email BOOLEAN NOT NULL DEFAULT TRUE,
  sms BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notification_preference UNIQUE (tenant_id, user_id, category)
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.module = 'notifications' AND p.action = 'view'
WHERE r.tenant_id IS NOT NULL OR r.is_system_role = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.module = 'invoices'
  AND p.action IN ('assign', 'approve', 'manage_settings')
WHERE r.name IN ('Owner', 'System Admin', 'Accountant')
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fee_structures', 'fee_assignments', 'late_fee_settings', 'late_fee_history',
    'student_discounts', 'security_deposit_transactions', 'notifications',
    'notification_preferences'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = NULLIF(current_setting(''hms.current_tenant_id'', TRUE), '''')::UUID) WITH CHECK (tenant_id = NULLIF(current_setting(''hms.current_tenant_id'', TRUE), '''')::UUID)',
      'tenant_isolation_' || table_name,
      table_name
    );
  END LOOP;
END $$;
