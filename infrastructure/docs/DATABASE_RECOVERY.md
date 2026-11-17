# PostgreSQL 16 Backup, Point-In-Time Recovery & Security Preservation Manual

## 1. Overview & Architecture

The Hostel Management System database runs on **PostgreSQL 16**. Data protection is architected around two complementary recovery tiers:

1. **Logical Tier (`pg_dump`):**
   - Captures DDL, schema, tables, indexes, constraints, foreign keys, triggers, and data.
   - Encrypted with GPG/KMS without writing plaintext to disk.
   - Provides portability across database instances, staging environments, and single-tenant recovery.
2. **Physical & Continuous WAL Archiving Tier (`pg_basebackup` + Continuous WAL):**
   - Captures physical data pages (`pg_basebackup`).
   - Continuously archives Write-Ahead Log (WAL) segments via `archive_command`.
   - Forces WAL segment switch every 15 minutes (`archive_timeout = 900`).
   - **Enables Point-In-Time Recovery (PITR)** to any second within the recovery window, supporting the **RPO: 15 minutes** project requirement.

---

## 2. Security & Multi-Tenancy Preservation Invariants

PostgreSQL recovery procedures must preserve five non-negotiable security invariants:

### 1. PostgreSQL 16 Engine Compatibility
- All backups and recovery procedures target `PostgreSQL 16` (`postgres:16.6-alpine`).
- Compatible with Prisma schema, native UUID generation, JSONB querying, and modern connection pooling.

### 2. FORCE ROW LEVEL SECURITY (RLS)
Every tenant-isolated table has RLS explicitly enabled and forced:
```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE residents FORCE ROW LEVEL SECURITY;
ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints FORCE ROW LEVEL SECURITY;
```
> [!IMPORTANT]
> `FORCE ROW LEVEL SECURITY` ensures that table owners or roles without `BYPASSRLS` cannot bypass tenant isolation policies. During restoration, `restore.sh` explicitly asserts that both `relrowsecurity` and `relforcerowsecurity` are `true` on every tenant table.

### 3. Application Runtime Role (`hms_app`) Boundary
- The application executes queries solely under the `hms_app` database role.
- Role definition:
  ```sql
  CREATE ROLE hms_app LOGIN PASSWORD '<secret>' NOSUPERUSER NOBYPASSRLS;
  GRANT CONNECT ON DATABASE hms_prod TO hms_app;
  GRANT USAGE ON SCHEMA public TO hms_app;
  ```
- **Privilege boundaries enforced by post-restore assertions:**
  - `hms_app` has **NO `DELETE`** on `tenants` or `permissions`.
  - `hms_app` has **NO `UPDATE` or `DELETE`** on `audit_logs` (immutability).
  - `hms_app` has **NO `INSERT` or `DELETE`** on `platform_admins`.

### 4. Database Indexes & Constraints
- Primary keys, foreign key constraints (with cascade or restrict behaviors), and multi-column indexes (such as `[tenant_id, branch_id, status]`) are preserved in full fidelity.

### 5. Multi-Tenant Data Isolation
- Tenant context is set per connection transaction via `SELECT set_config('hms.current_tenant_id', '<tenant_uuid>', true)`.
- Restored tables maintain the exact relational hierarchy tied to `tenant_id`.

---

## 3. Continuous WAL Archiving Configuration (RPO <= 15 min)

To achieve the 15-minute RPO architectural capability, PostgreSQL continuous WAL archiving is configured as follows:

### Configuration: `infrastructure/config/postgresql-pitr.conf`
```ini
wal_level = replica
archive_mode = on
archive_command = '/usr/local/bin/archive-wal.sh %p %f'
archive_timeout = 900
```

### How `archive-wal.sh` Works
1. When PostgreSQL completes a 16 MB WAL segment or when `archive_timeout` (900s / 15 min) elapses, PostgreSQL invokes `/usr/local/bin/archive-wal.sh %p %f`.
2. `%p` is the source path to the WAL file in `pg_wal/`.
3. `%f` is the segment filename (e.g. `000000010000000000000001`).
4. `archive-wal.sh` writes the segment atomically to `/var/lib/postgresql/wal_archive`.
5. If `BACKUP_OFFSITE_ENABLED=true`, it immediately replicates the WAL segment to remote off-site S3 storage (`s3://<bucket>/backups/hms/wal/<filename>`).

---

## 4. Point-In-Time Recovery (PITR) Execution Procedure

When rolling back to a specific timestamp `YYYY-MM-DD HH:MM:SS UTC`:

### Step 1: Prepare Clean PGDATA Directory
Stop PostgreSQL container and initialize target data directory from the baseline physical backup:
```bash
docker compose stop postgres
rm -rf /var/lib/docker/volumes/hms_postgres_data/_data/*
gpg --batch --yes --decrypt /var/backups/hms/<BASELINE_BACKUP>_postgres_physical.tar.gz.enc \
  | tar -xzf - -C /var/lib/docker/volumes/hms_postgres_data/_data
```

### Step 2: Configure Recovery Parameters
In `/var/lib/docker/volumes/hms_postgres_data/_data/`:
1. Create `recovery.signal`:
   ```bash
   touch /var/lib/docker/volumes/hms_postgres_data/_data/recovery.signal
   ```
2. Configure `restore_command` and `recovery_target_time`:
   ```bash
   cat <<EOF >> /var/lib/docker/volumes/hms_postgres_data/_data/postgresql.conf
   restore_command = '/usr/local/bin/restore-wal.sh %f %p'
   recovery_target_time = '2026-11-17 14:15:00 UTC'
   recovery_target_action = 'promote'
   EOF
   ```

### Step 3: Start PostgreSQL & Monitor Playback
```bash
docker compose up -d postgres
docker compose logs -f postgres
```
PostgreSQL will:
1. Enter archive recovery mode.
2. Read WAL segments sequentially using `/usr/local/bin/restore-wal.sh`.
3. Replay transactions until the exact target time `2026-11-17 14:15:00 UTC`.
4. Remove `recovery.signal` and promote the database to normal read/write operations.

---

## 5. Logical Restoration via `restore.sh`

For full database restoration from logical dumps:

```bash
# Dry run verification first:
./infrastructure/scripts/restore.sh \
  --manifest /var/backups/hms/hms_production_20261117_120000Z_manifest.json \
  --dry-run

# Restore to isolated staging database:
./infrastructure/scripts/restore.sh \
  --manifest /var/backups/hms/hms_production_20261117_120000Z_manifest.json \
  --target-db hms_recovery_verify

# Production restore (requires explicit two-factor confirmation):
export ALLOW_PRODUCTION_OVERWRITE=CONFIRM_DESTRUCTIVE_OVERWRITE
./infrastructure/scripts/restore.sh \
  --manifest /var/backups/hms/hms_production_20261117_120000Z_manifest.json \
  --target-db hms_prod \
  --confirm-overwrite
```

---

## 6. Post-Restoration SQL Verification Queries

Run these queries to verify the restored database's security posture:

```sql
-- 1. Verify all tenant tables have FORCE ROW LEVEL SECURITY enabled:
SELECT 
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relkind = 'r'
  AND c.relname IN ('tenants', 'branches', 'residents', 'admissions', 'invoices', 'payments', 'complaints')
ORDER BY c.relname;

-- 2. Verify runtime role hms_app permissions:
SELECT 
    rolname, 
    rolsuper, 
    rolbypassrls 
FROM pg_roles 
WHERE rolname = 'hms_app';
-- Expected: rolsuper = false, rolbypassrls = false

-- 3. Assert hms_app cannot delete tenants or modify audit logs:
SELECT 
    has_table_privilege('hms_app', 'public.tenants', 'DELETE') AS can_delete_tenants,
    has_table_privilege('hms_app', 'public.audit_logs', 'UPDATE') AS can_update_audit_logs,
    has_table_privilege('hms_app', 'public.audit_logs', 'DELETE') AS can_delete_audit_logs;
-- Expected: all three must be FALSE
```
