ALTER TABLE visitor_visits
  ADD COLUMN cnic_encrypted TEXT,
  ADD COLUMN cnic_fingerprint TEXT;

CREATE INDEX idx_visitor_visits_tenant_cnic_fingerprint
  ON visitor_visits (tenant_id, cnic_fingerprint)
  WHERE cnic_fingerprint IS NOT NULL;