CREATE UNIQUE INDEX users_id_tenant_id_key ON users (id, tenant_id);

ALTER TABLE residents
  ADD COLUMN user_id UUID;

CREATE UNIQUE INDEX residents_user_id_key ON residents (user_id);

CREATE UNIQUE INDEX residents_user_id_tenant_id_key ON residents (user_id, tenant_id);

ALTER TABLE residents
  ADD CONSTRAINT residents_user_id_tenant_id_fkey
  FOREIGN KEY (user_id, tenant_id)
  REFERENCES users (id, tenant_id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
