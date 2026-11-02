-- HMS Phase 0 Foundation Migration
-- PostgreSQL (proposed 🟡, pending G-02/OD-13)
-- All tenant-owned tables include tenant_id NOT NULL FK to tenants (SRS V2 §13.4.1)
-- RLS enabled as a backstop; application credentials do NOT have BYPASSRLS (SRS V2 §13.3)
-- Reviewed before production deployment as per IMPLEMENTATION_PLAN Phase 0.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'CLOSED');
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "BedStatus"    AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'OUT_OF_SERVICE');
CREATE TYPE "UserStatus"   AS ENUM ('ACTIVE', 'DEACTIVATED');
CREATE TYPE "PermissionAction" AS ENUM (
  'view', 'create', 'edit', 'delete', 'approve',
  'export', 'print', 'assign', 'verify', 'manage_settings'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TENANTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      "TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
  timezone    TEXT NOT NULL DEFAULT 'Asia/Karachi',
  currency    TEXT NOT NULL DEFAULT 'PKR',
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
-- BRANCHES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE branches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  name                TEXT NOT NULL,
  code                TEXT NOT NULL,
  address             TEXT,
  phone               TEXT,
  map_link            TEXT,
  status              "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  operating_settings  JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHYSICAL HIERARCHY: buildings → floors → rooms → beds
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE buildings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE floors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  building_id UUID NOT NULL REFERENCES buildings(id),
  level       INT NOT NULL,
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE rooms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  branch_id    UUID NOT NULL REFERENCES branches(id),
  floor_id     UUID NOT NULL REFERENCES floors(id),
  code         TEXT NOT NULL,
  bed_capacity INT NOT NULL DEFAULT 1 CHECK (bed_capacity > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE TABLE beds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  room_id     UUID NOT NULL REFERENCES rooms(id),
  code        TEXT NOT NULL,
  status      "BedStatus" NOT NULL DEFAULT 'AVAILABLE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, room_id, code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS and SCOPES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  email                 TEXT,
  phone                 TEXT,
  password_hash         TEXT NOT NULL,
  status                "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  last_login_at         TIMESTAMPTZ,
  mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_encrypted  TEXT,  -- field-encrypted with FIELD_ENCRYPTION_KEY
  token_version         INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  -- At least one of email or phone must be present (enforced in application layer + trigger)
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE user_tenant_memberships (
  user_id    UUID NOT NULL REFERENCES users(id),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  status     "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE user_branch_scopes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  branch_id  UUID NOT NULL REFERENCES branches(id),
  UNIQUE (user_id, branch_id)
);

CREATE TABLE user_gate_scopes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  branch_id  UUID NOT NULL REFERENCES branches(id),
  gate_ref   TEXT NOT NULL,
  UNIQUE (user_id, branch_id, gate_ref)
);

CREATE TABLE user_mess_scopes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  branch_id  UUID NOT NULL REFERENCES branches(id),
  UNIQUE (user_id, branch_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLES and PERMISSIONS (RBAC)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id),  -- NULL = system/platform role
  name           TEXT NOT NULL,
  description    TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE permissions (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module  TEXT NOT NULL,
  action  "PermissionAction" NOT NULL,
  UNIQUE (module, action)
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id    UUID NOT NULL REFERENCES users(id),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  role_id    UUID NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, tenant_id, role_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOGS — append-only (SRS V2 §4.11, §13.3)
-- Application role has no UPDATE/DELETE on this table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,    -- NULL for platform-level events; intentionally no FK for immutability
  branch_id     UUID,
  actor_user_id UUID,
  action        TEXT NOT NULL,
  module        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  outcome       TEXT NOT NULL,
  before_data   JSONB,   -- NEVER contains CNIC, health, biometric data (DB §13)
  after_data    JSONB,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES (SRS V2 §13.4.1 minimum required indexes)
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenants
CREATE INDEX idx_tenants_status ON tenants (status) WHERE deleted_at IS NULL;

-- Branches
CREATE INDEX idx_branches_tenant ON branches (tenant_id) WHERE deleted_at IS NULL;

-- Buildings / floors / rooms / beds
CREATE INDEX idx_buildings_branch  ON buildings (branch_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_floors_building   ON floors (building_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_rooms_branch      ON rooms (tenant_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_beds_room         ON beds (tenant_id, room_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_beds_status       ON beds (tenant_id, branch_id, status) WHERE deleted_at IS NULL;

-- Users
CREATE INDEX idx_users_tenant_status ON users (tenant_id, status) WHERE deleted_at IS NULL;

-- Audit logs (high-volume — partition candidates after load measurement)
CREATE INDEX idx_audit_tenant_created ON audit_logs (tenant_id, created_at);
CREATE INDEX idx_audit_entity         ON audit_logs (tenant_id, entity_type, entity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Proposed 🟡 — enabled as backstop per SRS V2 §13.3
-- Application credentials must NOT have BYPASSRLS.
-- Tenant context set via set_config('hms.current_tenant_id', ...) per transaction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tenant-scoped tables
ALTER TABLE branches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors                ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_scopes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_gate_scopes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mess_scopes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;

-- RLS policies — allow access only when tenant_id matches the session context
-- The application sets this via: SET LOCAL hms.current_tenant_id = '<uuid>';

CREATE POLICY tenant_isolation_branches ON branches
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_buildings ON buildings
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_floors ON floors
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_rooms ON rooms
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_beds ON beds
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_user_roles ON user_roles
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_audit ON audit_logs
  USING (
    tenant_id IS NULL OR
    tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID
  );

-- Scopes: filter by user_id (the application always passes the current user's id)
CREATE POLICY user_branch_scope_policy ON user_branch_scopes
  USING (branch_id IN (
    SELECT b.id
    FROM branches b
    WHERE b.tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID
  ));

-- NOTE: Platform admin access bypasses RLS via a separate superuser connection
-- with an approved, time-limited, audited grant (SRS V2 §13.1, PRD FR-005).
