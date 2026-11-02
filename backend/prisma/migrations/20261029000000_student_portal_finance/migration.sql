ALTER TABLE payments
  ADD COLUMN proof_file_name TEXT,
  ADD COLUMN proof_mime_type TEXT,
  ADD COLUMN proof_data BYTEA,
  ADD CONSTRAINT payments_proof_metadata_check CHECK (
    (proof_data IS NULL AND proof_file_name IS NULL AND proof_mime_type IS NULL)
    OR
    (proof_data IS NOT NULL AND proof_file_name IS NOT NULL AND proof_mime_type IS NOT NULL)
  ),
  ADD CONSTRAINT payments_proof_size_check CHECK (
    proof_data IS NULL OR octet_length(proof_data) <= 5242880
  );
