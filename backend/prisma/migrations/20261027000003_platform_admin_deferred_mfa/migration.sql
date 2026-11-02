ALTER TABLE platform_admins
  ALTER COLUMN mfa_secret_encrypted DROP NOT NULL,
  ADD COLUMN mfa_enrollment_secret_encrypted TEXT;

GRANT INSERT ON platform_admin_recovery_codes TO hms_app;
