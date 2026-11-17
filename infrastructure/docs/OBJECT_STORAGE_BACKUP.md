# SeaweedFS & S3-Compatible Object Storage Backup & Recovery Manual

## 1. Storage Architecture & Tenant Isolation

The Hostel Management System uses S3-compatible object storage (SeaweedFS in local/dev Compose environments; AWS S3, Cloudflare R2, or dedicated MinIO in production) to store sensitive binary assets outside the PostgreSQL database.

### Bucket Inventory & Multi-Tenant Prefix Conventions

| Bucket Identifier | Default Name | Access Level | Stored Artifacts | Object Key Prefix Convention |
|---|---|---|---|---|
| `OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS` | `private-proofs` | Private / Signed URLs | Payment bank deposit slips, transaction receipts | `payment-proofs/{tenantId}/{paymentId}` |
| `OBJECT_STORAGE_BUCKET_PRIVATE_DOCS` | `private-documents` | Private / Signed URLs | Student CNIC/B-form scans, admissions docs | `documents/{tenantId}/{branchId}/{residentId}/{docId}` |
| `OBJECT_STORAGE_BUCKET_PRIVATE_EXPORTS` | `private-exports` | Private / Temporary | Financial reconciliations, audit exports | `exports/{tenantId}/{exportId}.xlsx` |
| `OBJECT_STORAGE_BUCKET_PUBLIC_IMAGES` | `public-approved-images` | Public Read | Hostel photos, logos, public branding | `branding/{tenantId}/{imageId}.jpg` |

> [!IMPORTANT]
> **Tenant Key Preservation Rule:**
> Every stored object MUST preserve its hierarchical key prefix containing `{tenantId}`. Under no circumstances should object keys be flattened, stripped, or rearranged during backup or restoration.

---

## 2. Backup Mechanics

The backup script (`infrastructure/scripts/backup.sh`) supports two distinct operational modes:

### Mode A: Local SeaweedFS Container Volume Snapshot (Local/Dev/Staging)
When the `object-storage` container is running in Docker Compose:
1. An ephemeral container mounts `--volumes-from object-storage:ro`.
2. Packages `/data` directly to a tar stream.
3. Streams the tar archive through gzip compression and direct encryption (`encrypt_stream`).
4. Output file: `hms_${NODE_ENV}_${TS}_object_storage.tar.gz.enc`.
5. **Zero plaintext data is written to host disk during backup.**

### Mode B: External S3 API Synchronization (Production Overlay)
When running with an external HTTPS S3 provider (AWS S3, Cloudflare R2, MinIO):
1. An ephemeral helper container executes `aws s3 sync` against configured buckets (`private-proofs`, `private-documents`, etc.) using S3 API credentials.
2. Archives downloaded tenant structures to tar format.
3. Encrypts the stream directly with GPG/KMS.
4. Preserves object metadata, including the SHA-256 checksum in S3 user metadata (`x-amz-meta-sha256`).

---

## 3. Cryptographic Integrity & Checksum Verification

Every object stored in `private-proofs` has a corresponding SHA-256 hash recorded in the PostgreSQL database (`payments.proof_sha256` column) and in S3 object metadata.

### Verification Workflow:
1. During backup, the archive's overall SHA-256 hash is computed and recorded in `hms_*_checksums.sha256` and `hms_*_manifest.json`.
2. During restore or audit drills, objects can be cross-checked against database records:
   ```sql
   -- Verify payment proof object storage keys and SHA-256 recorded in DB:
   SELECT 
       id, 
       tenant_id, 
       proof_storage_key, 
       proof_sha256 
   FROM payments 
   WHERE proof_storage_key IS NOT NULL 
   LIMIT 10;
   ```
3. SHA-256 comparison:
   ```bash
   # Calculate hash of restored object:
   RESTORED_HASH=$(sha256sum /restored/payment-proofs/<tenantId>/<paymentId> | awk '{print $1}')
   # Compare with database proof_sha256 column:
   # Must match exactly (64 hex characters)
   ```

---

## 4. Restoration Procedures

### Full Object Storage Restoration
Object storage restoration is performed automatically as Step 5 of `./infrastructure/scripts/restore.sh`:

```bash
# Full restore including object storage:
./infrastructure/scripts/restore.sh \
  --manifest /var/backups/hms/<BACKUP_ID>_manifest.json \
  --target-db hms_recovery_verify

# To skip object storage and restore database only:
./infrastructure/scripts/restore.sh \
  --manifest /var/backups/hms/<BACKUP_ID>_manifest.json \
  --skip-storage
```

### Manual Tenant-Specific Object Extraction
To recover objects for a single tenant without overwriting other tenants:

```bash
TENANT_ID="<target-tenant-uuid>"
MANIFEST="/var/backups/hms/<BACKUP_ID>_manifest.json"
MANIFEST_DIR="$(dirname "$MANIFEST")"
OBJ_ARCHIVE=$(grep -o '"archiveFile": "[^"]*' "$MANIFEST" | cut -d'"' -f4)

# Extract only the target tenant's directory from the encrypted archive
mkdir -p /tmp/tenant_restore
gpg --batch --yes --decrypt "$MANIFEST_DIR/$OBJ_ARCHIVE" \
  | tar -xzf - -C /tmp/tenant_restore --wildcards "*/payment-proofs/${TENANT_ID}/*"

# Sync restored files to the active object storage bucket:
aws s3 sync /tmp/tenant_restore/payment-proofs/${TENANT_ID}/ \
  s3://private-proofs/payment-proofs/${TENANT_ID}/ \
  --endpoint-url "$OBJECT_STORAGE_URL"

# Securely wipe temporary decrypted data:
rm -rf /tmp/tenant_restore
```

---

## 5. Security & Fail-Closed Rules

1. **Mandatory Encryption:** Object storage backups containing student identity documents or payment proofs MUST NEVER be created or stored in plaintext.
2. **Fail-Closed Execution:** If encryption keys (GPG or KMS) are unavailable, `backup.sh` aborts immediately with exit code 1.
3. **Restricted File Permissions:** All backup files and temporary extraction folders enforce `umask 077` (owner read/write only: `chmod 600` / `chmod 700`).
