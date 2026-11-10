CREATE TYPE "StudentAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE');
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "StudentGatePassStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED');
CREATE TYPE "MealAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');
CREATE TYPE "MealSubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');
CREATE TYPE "StudentDocumentCategory" AS ENUM ('CNIC', 'B_FORM', 'PHOTO', 'ADMISSION', 'OTHER');

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  attendance_date DATE NOT NULL,
  status "StudentAttendanceStatus" NOT NULL,
  marked_by_user_id UUID NOT NULL REFERENCES users(id),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_records_once_per_day UNIQUE (tenant_id, branch_id, resident_id, attendance_date)
);
CREATE INDEX idx_attendance_records_branch_date
  ON attendance_records (tenant_id, branch_id, attendance_date, status);
CREATE INDEX idx_attendance_records_resident_date
  ON attendance_records (tenant_id, resident_id, attendance_date);

CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  status "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
  decision_by_user_id UUID REFERENCES users(id),
  decision_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_leave_requests_branch_status_start
  ON leave_requests (tenant_id, branch_id, status, start_date);
CREATE INDEX idx_leave_requests_resident_created
  ON leave_requests (tenant_id, resident_id, created_at DESC);

CREATE TABLE student_gate_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  exit_at TIMESTAMPTZ NOT NULL,
  expected_return_at TIMESTAMPTZ NOT NULL,
  actual_return_at TIMESTAMPTZ,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  status "StudentGatePassStatus" NOT NULL DEFAULT 'PENDING',
  decision_by_user_id UUID REFERENCES users(id),
  decision_at TIMESTAMPTZ,
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  return_recorded_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expected_return_at > exit_at),
  CHECK ((status = 'RETURNED' AND actual_return_at IS NOT NULL)
      OR (status <> 'RETURNED' AND actual_return_at IS NULL))
);
CREATE INDEX idx_student_gate_passes_branch_status_exit
  ON student_gate_passes (tenant_id, branch_id, status, exit_at);
CREATE INDEX idx_student_gate_passes_resident_created
  ON student_gate_passes (tenant_id, resident_id, created_at DESC);

CREATE TABLE meal_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  meal_date DATE NOT NULL,
  meal "MessMealType" NOT NULL,
  status "MealAttendanceStatus" NOT NULL,
  marked_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meal_attendance_once_per_meal UNIQUE (tenant_id, branch_id, resident_id, meal_date, meal)
);
CREATE INDEX idx_meal_attendance_branch_date_meal
  ON meal_attendance (tenant_id, branch_id, meal_date, meal, status);
CREATE INDEX idx_meal_attendance_resident_date
  ON meal_attendance (tenant_id, resident_id, meal_date);

CREATE TABLE meal_subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  monthly_amount_minor INTEGER NOT NULL CHECK (monthly_amount_minor >= 0),
  meal_types "MessMealType"[] NOT NULL CHECK (cardinality(meal_types) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_meal_subscription_plans_branch_active
  ON meal_subscription_plans (tenant_id, branch_id, is_active);

CREATE TABLE meal_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  plan_id UUID NOT NULL REFERENCES meal_subscription_plans(id),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status "MealSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  activated_by_user_id UUID NOT NULL REFERENCES users(id),
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX uq_meal_subscriptions_active_resident
  ON meal_subscriptions (tenant_id, branch_id, resident_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_meal_subscriptions_branch_status_dates
  ON meal_subscriptions (tenant_id, branch_id, status, starts_on, ends_on);
CREATE INDEX idx_meal_subscriptions_resident_start
  ON meal_subscriptions (tenant_id, resident_id, starts_on);

CREATE TABLE student_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  category "StudentDocumentCategory" NOT NULL,
  original_name TEXT NOT NULL CHECK (length(btrim(original_name)) BETWEEN 1 AND 180),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  file_data BYTEA NOT NULL CHECK (octet_length(file_data) BETWEEN 1 AND 14680064),
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_student_documents_resident_category
  ON student_documents (tenant_id, branch_id, resident_id, category);

CREATE TABLE room_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  from_bed_id UUID NOT NULL REFERENCES beds(id),
  from_room_code TEXT NOT NULL,
  from_bed_code TEXT NOT NULL,
  to_bed_id UUID NOT NULL REFERENCES beds(id),
  to_room_code TEXT NOT NULL,
  to_bed_code TEXT NOT NULL,
  previous_allocation_id UUID NOT NULL REFERENCES bed_allocations(id),
  new_allocation_id UUID NOT NULL REFERENCES bed_allocations(id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  transferred_by_user_id UUID NOT NULL REFERENCES users(id),
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_bed_id <> to_bed_id)
);
CREATE INDEX idx_room_transfers_resident_time
  ON room_transfers (tenant_id, branch_id, resident_id, transferred_at DESC);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'attendance_records', 'leave_requests', 'student_gate_passes',
    'meal_attendance', 'meal_subscription_plans', 'meal_subscriptions',
    'student_documents', 'room_transfers'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = NULLIF(current_setting(''hms.current_tenant_id'', TRUE), '''')::UUID) WITH CHECK (tenant_id = NULLIF(current_setting(''hms.current_tenant_id'', TRUE), '''')::UUID)',
      'tenant_isolation_' || table_name,
      table_name
    );
  END LOOP;
END
$$;

INSERT INTO permissions (id, module, action)
SELECT gen_random_uuid(), module_name, action_name::"PermissionAction"
FROM (VALUES
  ('attendance'), ('leave_requests'), ('meal_attendance'),
  ('meal_subscriptions'), ('student_documents')
) AS modules(module_name)
CROSS JOIN unnest(enum_range(NULL::"PermissionAction")) AS actions(action_name)
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module IN (
  'attendance', 'leave_requests', 'meal_attendance',
  'meal_subscriptions', 'student_documents'
)
WHERE roles.name IN ('Owner', 'System Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'attendance'
  AND permissions.action IN ('view', 'create', 'edit')
WHERE roles.name = 'Warden'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'attendance' AND permissions.action = 'view'
WHERE roles.name IN ('Receptionist', 'Resident')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'leave_requests'
  AND permissions.action IN ('view', 'approve')
WHERE roles.name = 'Warden'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'leave_requests'
  AND permissions.action IN ('view', 'create')
WHERE roles.name = 'Resident'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'meal_attendance'
  AND permissions.action IN ('view', 'create', 'edit')
WHERE roles.name = 'Mess Staff'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'meal_attendance' AND permissions.action = 'view'
WHERE roles.name IN ('Warden', 'Receptionist', 'Resident')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'meal_subscriptions'
  AND permissions.action IN ('view', 'create', 'edit', 'manage_settings')
WHERE roles.name IN ('Warden', 'Mess Staff')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'meal_subscriptions' AND permissions.action = 'view'
WHERE roles.name = 'Resident'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'student_documents'
  AND permissions.action IN ('view', 'create', 'edit', 'delete')
WHERE roles.name = 'Warden'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'student_documents'
  AND permissions.action IN ('view', 'create')
WHERE roles.name = 'Resident'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'student_documents' AND permissions.action = 'view'
WHERE roles.name = 'Receptionist'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'exports' AND permissions.action = 'export'
WHERE roles.name IN ('Warden', 'Owner', 'System Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.module = 'allocations'
  AND permissions.action IN ('view', 'assign')
WHERE roles.name IN ('Warden', 'Receptionist', 'Owner', 'System Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
