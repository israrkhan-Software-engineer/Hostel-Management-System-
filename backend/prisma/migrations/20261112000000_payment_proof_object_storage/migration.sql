ALTER TABLE payments
  ADD COLUMN proof_storage_key TEXT,
  ADD COLUMN proof_sha256 CHAR(64);

ALTER TABLE payments
  DROP CONSTRAINT payments_proof_metadata_check,
  ADD CONSTRAINT payments_proof_metadata_check CHECK (
    (
      proof_data IS NULL
      AND proof_storage_key IS NULL
      AND proof_file_name IS NULL
      AND proof_mime_type IS NULL
    )
    OR (
      proof_data IS NOT NULL
      AND proof_storage_key IS NULL
      AND proof_file_name IS NOT NULL
      AND proof_mime_type IS NOT NULL
    )
    OR (
      proof_data IS NULL
      AND proof_storage_key IS NOT NULL
      AND proof_file_name IS NOT NULL
      AND proof_mime_type IS NOT NULL
    )
  ),
  ADD CONSTRAINT payments_proof_sha256_check CHECK (
    proof_sha256 IS NULL OR proof_sha256 ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX uq_payments_proof_storage_key
  ON payments (proof_storage_key)
  WHERE proof_storage_key IS NOT NULL;
