-- Phase 5: manual visitor registration, approval, and gate check-in/out.

CREATE TYPE "VisitorVisitStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CHECKED_IN',
  'CHECKED_OUT'
);

CREATE TABLE visitor_visits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  branch_id             UUID NOT NULL REFERENCES branches(id),
  host_resident_id      UUID NOT NULL REFERENCES residents(id),
  visitor_name          TEXT NOT NULL CHECK (length(btrim(visitor_name)) > 0),
  visitor_phone         TEXT,
  purpose               TEXT NOT NULL CHECK (length(btrim(purpose)) > 0),
  status                "VisitorVisitStatus" NOT NULL DEFAULT 'PENDING',
  created_by_user_id    UUID NOT NULL REFERENCES users(id),
  approved_by_user_id   UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  checked_in_by_user_id UUID REFERENCES users(id),
  checked_in_at         TIMESTAMPTZ,
  checked_out_by_user_id UUID REFERENCES users(id),
  checked_out_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visitor_visits_tenant_branch_status_created
  ON visitor_visits (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX idx_visitor_visits_tenant_branch_name_created
  ON visitor_visits (tenant_id, branch_id, visitor_name, created_at DESC);
CREATE INDEX idx_visitor_visits_tenant_host_created
  ON visitor_visits (tenant_id, host_resident_id, created_at DESC);

ALTER TABLE visitor_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_visitor_visits ON visitor_visits
  USING (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('hms.current_tenant_id', TRUE)::UUID);
