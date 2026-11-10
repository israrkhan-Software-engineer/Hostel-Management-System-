CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'VOID');
CREATE TYPE "PlatformPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER');

CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  monthly_price_minor INTEGER NOT NULL CHECK (monthly_price_minor >= 0),
  yearly_price_minor INTEGER NOT NULL CHECK (yearly_price_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  user_limit INTEGER NOT NULL CHECK (user_limit > 0),
  branch_limit INTEGER NOT NULL CHECK (branch_limit > 0),
  features JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans
  (id, name, description, monthly_price_minor, yearly_price_minor, currency, user_limit, branch_limit, features)
VALUES
  (gen_random_uuid(), 'Basic', 'Essential hostel operations', 0, 0, 'PKR', 10, 1,
   '{"tenants":true,"branches":true,"residents":true,"admissions":true,"allocations":true,"invoices":true,"payments":true,"payment_proofs":true,"visitors":true,"gate_passes":true,"gate_events":true,"mess":true,"complaints":true,"maintenance":true,"inventory":true,"notifications":true,"notices":true,"reports":true,"exports":false,"users":true,"roles":true,"public_content":true,"offline_sync":true,"backups":true,"attendance":true,"leave_requests":true,"meal_attendance":true,"meal_subscriptions":true,"student_documents":true}'),
  (gen_random_uuid(), 'Standard', 'Growing hostel operations', 0, 0, 'PKR', 50, 5,
   '{"tenants":true,"branches":true,"residents":true,"admissions":true,"allocations":true,"invoices":true,"payments":true,"payment_proofs":true,"visitors":true,"gate_passes":true,"gate_events":true,"mess":true,"complaints":true,"maintenance":true,"inventory":true,"notifications":true,"notices":true,"reports":true,"exports":true,"users":true,"roles":true,"public_content":true,"offline_sync":true,"backups":true,"attendance":true,"leave_requests":true,"meal_attendance":true,"meal_subscriptions":true,"student_documents":true}'),
  (gen_random_uuid(), 'Premium', 'Full access for large operations', 0, 0, 'PKR', 250, 25,
   '{"tenants":true,"branches":true,"residents":true,"admissions":true,"allocations":true,"invoices":true,"payments":true,"payment_proofs":true,"visitors":true,"gate_passes":true,"gate_events":true,"mess":true,"complaints":true,"maintenance":true,"inventory":true,"notifications":true,"notices":true,"reports":true,"exports":true,"users":true,"roles":true,"public_content":true,"offline_sync":true,"backups":true,"attendance":true,"leave_requests":true,"meal_attendance":true,"meal_subscriptions":true,"student_documents":true}');

CREATE TABLE tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  billing_interval "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  period_started_at TIMESTAMPTZ NOT NULL,
  period_ends_at TIMESTAMPTZ NOT NULL,
  suspended_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_ends_at > period_started_at),
  CHECK (trial_ends_at IS NULL OR trial_started_at IS NULL OR trial_ends_at > trial_started_at)
);
CREATE INDEX idx_tenant_subscriptions_tenant_status_end
  ON tenant_subscriptions (tenant_id, status, period_ends_at DESC);
CREATE INDEX idx_tenant_subscriptions_plan_status
  ON tenant_subscriptions (plan_id, status);
CREATE UNIQUE INDEX uq_tenant_subscriptions_one_current
  ON tenant_subscriptions (tenant_id)
  WHERE status IN ('TRIAL', 'ACTIVE', 'SUSPENDED');
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM roles
    WHERE tenant_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY tenant_id, lower(name)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active tenant role names exist; resolve them before applying the Phase 4 migration';
  END IF;
END $$;

CREATE UNIQUE INDEX uq_tenant_roles_active_name
  ON roles (tenant_id, lower(name))
  WHERE tenant_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE subscription_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id),
  event TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscription_history_tenant_created
  ON subscription_history (tenant_id, created_at DESC);

CREATE TABLE trial_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  duration_days INTEGER NOT NULL DEFAULT 14 CHECK (duration_days BETWEEN 1 AND 365),
  trial_plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  notify_days_before INTEGER NOT NULL DEFAULT 3 CHECK (notify_days_before BETWEEN 0 AND 90),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL,
  status "PlatformInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  due_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_platform_invoices_tenant_status_due
  ON platform_invoices (tenant_id, status, due_at);

CREATE TABLE platform_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method "PlatformPaymentMethod" NOT NULL,
  reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  recorded_by UUID NOT NULL REFERENCES platform_admins(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);
CREATE INDEX idx_platform_payments_tenant_received
  ON platform_payments (tenant_id, received_at DESC);

INSERT INTO trial_settings (id, duration_days, trial_plan_id, notify_days_before)
SELECT 1, 14, id, 3 FROM subscription_plans WHERE name = 'Basic';

INSERT INTO tenant_subscriptions (
  tenant_id, plan_id, status, billing_interval, trial_started_at, trial_ends_at,
  period_started_at, period_ends_at
)
SELECT t.id, p.id, 'TRIAL', 'MONTHLY', NOW(), NOW() + INTERVAL '14 days',
       NOW(), NOW() + INTERVAL '14 days'
FROM tenants t
CROSS JOIN subscription_plans p
WHERE p.name = 'Basic' AND t.deleted_at IS NULL;

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_plans_read ON subscription_plans FOR SELECT
  USING (
    NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM tenant_subscriptions s
      WHERE s.plan_id = subscription_plans.id
        AND s.tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    )
  );
CREATE POLICY subscription_plans_platform_write ON subscription_plans FOR ALL
  USING (NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_subscriptions_scope ON tenant_subscriptions FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
  );

ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_history_platform_only ON subscription_history FOR ALL
  USING (NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL);

ALTER TABLE trial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY trial_settings_platform_only ON trial_settings FOR ALL
  USING (NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL);

ALTER TABLE platform_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_invoices_scope ON platform_invoices FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
  );

ALTER TABLE platform_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payments_scope ON platform_payments FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('hms.current_tenant_id', TRUE), '')::UUID
    OR NULLIF(current_setting('hms.platform_admin_id', TRUE), '') IS NOT NULL
  );

GRANT SELECT, INSERT, UPDATE ON subscription_plans TO hms_app;
GRANT SELECT, INSERT, UPDATE ON tenant_subscriptions TO hms_app;
GRANT SELECT, INSERT ON subscription_history TO hms_app;
GRANT SELECT, INSERT, UPDATE ON trial_settings TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform_invoices TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform_payments TO hms_app;
