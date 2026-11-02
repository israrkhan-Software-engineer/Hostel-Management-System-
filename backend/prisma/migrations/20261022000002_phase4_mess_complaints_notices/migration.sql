-- Phase 4: weekly mess menus, trackable complaints, and branch notices.

CREATE TYPE "MessMealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "ComplaintPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "NoticeStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE mess_menus (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  week_start          DATE NOT NULL,
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mess_menus_tenant_branch_week UNIQUE (tenant_id, branch_id, week_start)
);

CREATE INDEX idx_mess_menus_tenant_branch_week
  ON mess_menus (tenant_id, branch_id, week_start DESC);

CREATE TABLE mess_menu_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  menu_id       UUID NOT NULL REFERENCES mess_menus(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  meal          "MessMealType" NOT NULL,
  description   TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mess_menu_entry_day_meal UNIQUE (menu_id, day_of_week, meal)
);

CREATE INDEX idx_mess_menu_entries_tenant_branch_menu
  ON mess_menu_entries (tenant_id, branch_id, menu_id);

CREATE TABLE complaints (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  branch_id             UUID NOT NULL REFERENCES branches(id),
  title                 TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  description           TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  status                "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
  priority              "ComplaintPriority" NOT NULL DEFAULT 'NORMAL',
  submitted_by_user_id  UUID NOT NULL REFERENCES users(id),
  assigned_to_user_id   UUID REFERENCES users(id),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_complaints_tenant_branch_status_created
  ON complaints (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX idx_complaints_tenant_submitter_created
  ON complaints (tenant_id, submitted_by_user_id, created_at DESC);

CREATE TABLE notices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  title               TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  body                TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  status              "NoticeStatus" NOT NULL DEFAULT 'DRAFT',
  starts_at           DATE,
  ends_at             DATE,
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_notice_date_window CHECK (
    starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at
  )
);

CREATE INDEX idx_notices_tenant_branch_status_window
  ON notices (tenant_id, branch_id, status, starts_at, ends_at);

ALTER TABLE mess_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mess_menus ON mess_menus
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE mess_menu_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mess_menu_entries ON mess_menu_entries
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_complaints ON complaints
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notices ON notices
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);
