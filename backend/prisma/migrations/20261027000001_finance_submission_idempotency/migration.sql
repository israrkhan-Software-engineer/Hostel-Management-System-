ALTER TABLE payments
  ADD COLUMN submission_key UUID;

CREATE UNIQUE INDEX uq_payments_submission_key
  ON payments (tenant_id, branch_id, invoice_id, recorded_by_user_id, submission_key);

ALTER TABLE refunds
  ADD COLUMN submission_key UUID;

CREATE UNIQUE INDEX uq_refunds_submission_key
  ON refunds (tenant_id, branch_id, invoice_id, recorded_by_user_id, submission_key);
