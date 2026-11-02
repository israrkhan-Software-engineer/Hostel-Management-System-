ALTER TABLE "tenants"
  ADD COLUMN "location_address" TEXT NOT NULL DEFAULT '';

ALTER TABLE "users"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT;
