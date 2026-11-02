-- Phase 2 core domain: resident admission and bed allocation lifecycle.
-- Sensitive CNIC values are encrypted by the application; only keyed fingerprints
-- are used for duplicate detection.

CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "AdmissionStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'
);
CREATE TYPE "AllocationStatus" AS ENUM ('RESERVED', 'CHECKED_IN', 'ENDED');

CREATE TABLE residents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  branch_id         UUID NOT NULL REFERENCES branches(id),
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  date_of_birth     DATE,
  cnic_encrypted    TEXT,
  cnic_fingerprint  TEXT UNIQUE,
  status            "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_residents_tenant_branch_name
  ON residents (tenant_id, branch_id, last_name, first_name);

CREATE TABLE admissions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  branch_id             UUID NOT NULL REFERENCES branches(id),
  resident_id           UUID NOT NULL REFERENCES residents(id),
  status                "AdmissionStatus" NOT NULL DEFAULT 'PENDING',
  requested_check_in_at TIMESTAMPTZ,
  notes                 TEXT,
  rejection_reason      TEXT,
  decided_by_user_id    UUID REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  checked_in_at         TIMESTAMPTZ,
  checked_out_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_admissions_tenant_branch_status
  ON admissions (tenant_id, branch_id, status, created_at);
CREATE INDEX idx_admissions_tenant_resident
  ON admissions (tenant_id, resident_id, created_at);

CREATE TABLE bed_allocations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  branch_id    UUID NOT NULL REFERENCES branches(id),
  admission_id UUID NOT NULL REFERENCES admissions(id),
  resident_id  UUID NOT NULL REFERENCES residents(id),
  bed_id       UUID NOT NULL REFERENCES beds(id),
  status       "AllocationStatus" NOT NULL DEFAULT 'RESERVED',
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ
);

CREATE INDEX idx_bed_allocations_tenant_branch_status
  ON bed_allocations (tenant_id, branch_id, status);
CREATE INDEX idx_bed_allocations_tenant_resident_status
  ON bed_allocations (tenant_id, resident_id, status);
CREATE UNIQUE INDEX uq_bed_allocations_active_bed
  ON bed_allocations (bed_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uq_bed_allocations_active_resident
  ON bed_allocations (resident_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uq_bed_allocations_active_admission
  ON bed_allocations (admission_id) WHERE ended_at IS NULL;

ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_residents ON residents
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_admissions ON admissions
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);

ALTER TABLE bed_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bed_allocations ON bed_allocations
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);
