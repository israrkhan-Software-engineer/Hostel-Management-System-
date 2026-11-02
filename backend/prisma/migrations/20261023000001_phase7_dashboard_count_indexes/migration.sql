CREATE INDEX "beds_tenant_branch_status_deleted_at_idx"
  ON "beds" ("tenant_id", "branch_id", "status", "deleted_at");

CREATE INDEX "residents_tenant_branch_status_deleted_at_idx"
  ON "residents" ("tenant_id", "branch_id", "status", "deleted_at");
