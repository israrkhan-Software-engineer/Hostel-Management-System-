ALTER TABLE complaints
  ADD COLUMN client_mutation_id UUID,
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX uq_complaints_offline_submission
  ON complaints (tenant_id, submitted_by_user_id, client_mutation_id);
CREATE INDEX idx_complaints_tenant_branch_deleted
  ON complaints (tenant_id, branch_id, deleted_at);

ALTER TABLE visitor_visits
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX idx_visitor_visits_tenant_branch_deleted
  ON visitor_visits (tenant_id, branch_id, deleted_at);
