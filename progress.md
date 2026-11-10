# Remaining Tasks Progress

Execution is sequential. No database reset or destructive migration command is used.

## Addendum — 2026-11-10 (performance and object storage)

- Added a private S3-compatible payment-proof provider, checksum persistence/verification, and permission-checked API streaming. New uploads no longer put proof bytes in PostgreSQL.
- Added `20261112000000_payment_proof_object_storage` as an additive migration. It preserves legacy `proof_data`; `backend/scripts/migrate-payment-proofs.ts` uploads legacy records and persists SHA-256 integrity hashes through a migration-only RLS-bypass connection before clearing each row's bytea data. Neither migration nor backfill was run.
- PDF creation and proof storage I/O now occur outside request-scoped tenant transactions. DB reads/writes use explicit short tenant contexts; the invoice lock remains around the payment-balance check and creation.
- Wired `DATABASE_POOL_MAX` to Prisma's `connection_limit`, configured local object-storage settings, retries for queued jobs, and a shared portal connectivity hook. Extracted the student fees/payment panel and its shared finance types/formatting from the main portal component.
- Moved gate visitor operations under the `visitors` domain module and retained compatibility exports for existing phase-based import paths.
- No tests were run. Do not claim production-scale performance, RPO/RTO, or throughput verification; remaining historical phase-named backend modules need later behavior-preserving domain decomposition.

## Addendum — 2026-11-02 (local-only follow-up)

This update supersedes the earlier scope note that admission/inventory/complaint/visitor CRUD was unapproved. The user approved pending-only admission edit/cancel, dependency-checked inventory updates and soft archive, resolved/closed complaint archive, rejected/checked-out visitor archive, and a complaint-only offline outbox. Biometrics remain excluded; visitor hours and retention/backup policies remain deferred.

- Added the local API/UI paths, permission checks, audit entries, a complaint outbox in browser session storage, server-side complaint idempotency, and an additive Prisma migration for idempotency and archive timestamps.
- The new migration is not applied to any database. No live DB, authenticated account, hosted CI, staging, or production environment was accessed.
- Local validation: backend 20 suites / 154 tests, frontend 6 suites / 23 tests, backend/frontend typecheck and lint, Prisma validation, and backend/frontend production builds pass.
- Rebuilt and inspected the workspace-root `HMS_Phase1.zip`; it includes current source/docs and excludes environment secrets, dependencies, and generated build output.
- Started a separate disposable PostgreSQL/Redis test stack, applied all migrations, and passed both integration suites (15/15 tests). The two failures from the earlier historical integration run did not reproduce; the tenant-local overdue-midnight boundary and concurrent admission checks passed.
- Ran `backend/scripts/phase7-restore-smoke.mjs`; synthetic PostgreSQL dump/restore passed in its own disposable container, with no HMS application data used. Test services and container were cleaned up.
- These checks do not apply the new migration to a persistent HMS database, verify hosted CI, or certify backup recovery for real application/object-store data.
- The prior notes about the legacy visitor row, backup/retention, BullMQ, MFA acceptance, and production pilot remain external blockers. The two tenant integration startup failures were not reproduced in the latest disposable local run; hosted-CI confirmation remains open.

## Task 1 — PostgreSQL RLS & Tenant Isolation

**Status: COMPLETED**

- Inspected `TenantGuard`, tenant-context interceptor, Prisma transaction-scoped context, branch-scope and permission guards, RLS migrations, runtime role setup, RLS integration tests, CI integration job, and existing unit tests.
- Tenant-protected guards scope their own database reads with `runWithTenantContext`; the request interceptor then wraps handler queries in a transaction-local tenant context. Invalid tenant IDs are rejected, and the runtime role startup check denies superuser, `BYPASSRLS`, and inherited elevated-role membership.
- RLS migrations use forced RLS on the listed tenant-owned tables and policies cover tenant-scoped operations. The existing PostgreSQL integration suite exercises missing-context denial, cross-tenant SELECT/INSERT/UPDATE/DELETE, pooled/concurrent request isolation, and runtime-role properties.
- Fixed invalid/missing tenant context to raise an explicit `ForbiddenException`.
- Fixed a shared-transaction context race in platform tenant listing by making tenant-scoped user-count queries sequential; added a regression test.
- Tests: backend typecheck passed; backend lint passed; focused tenant-guard and platform-admin service tests passed (2 suites, 6 tests).
- Provisioned an isolated disposable PostgreSQL 16 `hms_test` database on port 25432; all 10 real PostgreSQL integration tests passed. This includes non-superuser/NOBYPASSRLS validation, forced and fail-closed RLS policies, tenant-scoped reads, denied cross-tenant inserts, cross-tenant update/delete isolation, and pooled/concurrent request-context isolation.
- The runtime-role assertion query was corrected to avoid the reserved `current_role` alias. Expected unique-constraint and RLS failures now use savepoints so a PostgreSQL statement error does not poison the remainder of an interactive test transaction.
- Applied the tenant-context RLS migration to the existing HMS database and verified using its `hms_app` role: tenant-scoped reads expose no other tenant rows; cross-tenant INSERT is denied; cross-tenant UPDATE/DELETE affect zero rows; no-context reads expose no residents; invalid platform-admin context exposes no tenant records.
- Verified a synthetic resident create/read/update across separate transactions/delete through the actual HMS `hms_app` role; the synthetic record was removed. PostgreSQL integration tests continue to cover pooled/concurrent request isolation, cross-tenant CRUD, and non-bypass role properties.
- Added an active-platform-admin context policy for tenant registry read/insert/update; tests prove inactive platform-admin context cannot write tenants. Runtime tenant deletion remains ungranted.
- Added optional MFA enrollment at operator bootstrap with mandatory first-login enrollment for accounts that defer it. Enrollment uses an expiring, scope-limited token, encrypted pending secret, rate-limited TOTP confirmation, one-time recovery codes, and audit logging; no dashboard JWT is issued before enrollment. Added an additive schema migration and PostgreSQL HTTP coverage. The updated API/frontend are deployed; all 14 migrations are applied to the existing HMS database.
- **Latest focused verification:** platform-admin PostgreSQL HTTP integration suite passed 4/4 tests, including deferred enrollment, denial of the enrollment token at dashboard APIs, invalid-code rejection, token replay rejection, and one-time recovery-code login. Full backend unit suite passed 19 suites / 124 tests; backend/frontend typecheck and lint and frontend production build passed. A full PostgreSQL integration run currently has two failures in the existing tenant suite (admission-concurrency transaction startup and a follow-on pooled transaction startup); the platform-admin suite passes independently.
- **Verification:** all tenant RLS requirements are verified in the local HMS database and disposable PostgreSQL integration tests. CI-hosted execution remains unverified under Task 7.
- **Files changed:** `backend/src/common/guards/tenant.guard.ts`, `backend/src/common/guards/tenant.guard.spec.ts`, `backend/src/common/prisma/prisma.service.ts`, `backend/src/modules/platform-admin/platform-admin.service.ts`, `backend/src/modules/platform-admin/platform-admin.service.spec.ts`, `backend/test/integration/tenant-rls.spec.ts`.

## Task 2 — Database Configuration & Migration Verification

**Status: PARTIALLY COMPLETED**

- Inspected local database configuration and current Compose services. PostgreSQL and Redis are healthy on the existing persistent HMS volumes; the API and frontend are healthy. Read-only checks used the configured local DB credentials without displaying them.
- Initial read-only Prisma migration status found 12 migrations in source, with the RLS, platform-admin, and finance idempotency migrations pending. The migration preflight and subsequent deployment results are recorded below.
- Provisioned a separate disposable PostgreSQL 16 database `hms_test`; all 13 migrations are applied and migration status is up to date.
- `prisma validate` passed.
- Inspected migrations/schema: room capacity is constrained to 1–10 and the additive migration validates the constraint; visitor CNIC columns remain nullable for legacy records while new-visit DTO validation requires a CNIC and code stores encrypted/fingerprinted values.
- Backend inventory and Phase 5 service tests passed (2 suites, 12 tests).
- Before migration, a read-only catalog query confirmed the platform-admin table was absent and the stale API returned HTTP 404 for the platform-admin login endpoint.
- Reviewed the pending migration prerequisites against the existing database: no orphan password-reset tokens, no reset tokens lacking a tenant, and no rooms outside the 1–10 bed-capacity range. Created and verified a protected DPAPI backup before deployment.
- Applied the three previously pending migrations and the additional platform-admin tenant-RLS migration to the existing HMS database. `prisma migrate status` reports all 13 migrations up to date. The API uses `hms_app`; catalog verification confirms it is `NOSUPERUSER NOBYPASSRLS`. The platform-admin tables are present.
- **Remaining:** one existing visitor record has no encrypted CNIC/fingerprint. The visitor migration intentionally allows nullable legacy records; no value was fabricated or overwritten. Broader workflows beyond the verified synthetic resident CRUD remain untested against existing business records.
- **Files changed:** `progress.md`.

## Task 3 — Payment & Refund Reliability

**Status: PARTIALLY COMPLETED**

- Inspected payment/refund forms, shared mutation/error handling, finance DTOs, service transactions, and existing finance tests.
- Fixed payment and refund forms so values reset only after a successful API response; failures leave form values available for correction/retry and surface the existing error message.
- Added synchronous in-flight locks per invoice/action and stable UUID idempotency keys for unchanged retries. Changed form details receive a new key.
- Added required idempotency key validation to both API DTOs and additive nullable DB columns/unique indexes for legacy compatibility. Service locks the invoice row, replays a matching prior result without a second write/audit, and rejects key reuse with different details. Refund bounds remain enforced within the same locked transaction.
- Added tests for failed-form retention/success reset, key reuse/rotation, payment retry without duplicate write/audit, refund retry, key-value conflict, and over-refund rejection.
- Tests: Prisma client generation succeeded; backend typecheck/lint and FinanceService tests passed (11 tests); frontend typecheck/lint and finance-submission tests passed (2 tests).
- Applied and verified all 13 migrations, including the additive idempotency and platform-admin tenant-RLS migrations, on both the disposable PostgreSQL test DB and the existing HMS database. The integration suite passed database uniqueness checks for duplicate payment and refund submission keys; finance unit tests cover successful/failed submissions and retries. Live payment/refund retry workflows have not yet been rerun against the existing HMS DB.
- **Files changed:** `frontend/src/components/phase2-workspace.tsx`, `frontend/src/lib/finance/submission.ts`, `frontend/src/lib/finance/submission.spec.ts`, `backend/src/modules/finance/finance.dto.ts`, `backend/src/modules/finance/finance.service.ts`, `backend/src/modules/finance/finance.service.spec.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261027000001_finance_submission_idempotency/migration.sql`, `progress.md`.

## Task 4 — Super Admin Dashboard & Management APIs

**Status: PARTIALLY COMPLETED**

- Re-inspected the `/system-admin` workspace, separate platform-admin login, dashboard/tenant/user/audit API controller and service, platform guard, DTOs, auth service, migrations, and setup documentation. The Super Admin scope is expressly requested in this task and the preceding user instruction; ordinary tenant `System Admin` accounts remain separate.
- Verified implementation surfaces for tenant and user statistics, paginated/filterable tenant/user/audit lists, tenant create/view/update/activate/suspend, user status/role updates, and actor audit records. API requires a `platform-admin` JWT and checks active administrator/token version; platform login requires MFA.
- Fixed status DTO validation: the status endpoint now accepts only `ACTIVE` and `SUSPENDED`, rather than all tenant lifecycle states.
- Added guard tests proving missing credentials, tenant-scoped tokens, and inactive/revoked platform admins are rejected; added status DTO tests. Platform service tests cover tenant statistics, create/audit behavior, and serial tenant scopes.
- Tests: backend typecheck/lint passed; platform guard/DTO/service tests passed (3 suites, 12 tests). Frontend typecheck/lint and API-client tests passed (9 tests). After deployment, focused platform-admin guard/DTO/service suite: 3 suites / 19 tests passed. Added real-PostgreSQL HTTP integration coverage for login validation, recovery-code single-use, role-scope rejection, dashboard statistics, tenant lifecycle, tenant-user deactivation, audit events, and inactive-admin RLS denial.
- Rebuilt the frontend and API containers. After checking migration-sensitive records and verifying a protected backup, applied the three previously pending migrations and the additive platform-admin tenant-RLS migration to the existing HMS database; no database reset or destructive migration was used. The production frontend build succeeded and `/system-admin` rendered in the browser, redirecting unauthenticated access to the MFA platform-admin login.
- The stale API was rebuilt and redeployed after the migration preflight and protected backup. `/api/health/ready` returns HTTP 200; an empty POST to `/api/v1/platform/admin/auth/login` now returns HTTP 400 validation response (not 404), confirming the route is registered; all three platform-admin tables exist.
- The running app role is confirmed `NOSUPERUSER NOBYPASSRLS`; table privilege checks confirm `hms_app` can access the required tenant, room, payment, and platform-admin tables. An unauthenticated dashboard request returns HTTP 401. At this audit point, bootstrap was still pending; see the later account-creation update below.
- Following the user's request, created the first app platform administrator as `admin@example.test` with a newly generated unique password and deferred MFA. The account is ACTIVE; the audit event was recorded, and a real login request with the generated credential returned an MFA-enrollment challenge but no access token. The authenticator enrollment and subsequent dashboard/browser management flow remain for the user to complete.
- **Files changed:** `backend/src/modules/platform-admin/platform-admin.dto.ts`, `backend/src/modules/platform-admin/platform-admin.dto.spec.ts`, `backend/src/modules/platform-admin/platform-admin.guard.spec.ts`, `backend/src/modules/platform-admin/platform-auth.dto.ts`, `backend/src/modules/platform-admin/platform-auth.service.ts`, `backend/src/modules/platform-admin/platform-admin.controller.ts`, `backend/scripts/platform-admin-bootstrap.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261027000002_platform_admin_tenant_rls/migration.sql`, `backend/prisma/migrations/20261027000003_platform_admin_deferred_mfa/migration.sql`, `backend/test/integration/platform-admin-auth.spec.ts`, `docker-compose.test.yml`, `.github/workflows/ci.yml`, `frontend/src/app/(auth)/platform-admin/login/page.tsx`, `README.md`, `progress.md`, `gap.md`, `memory.md`.

## Task 5 — Missing CRUD & Admission Rules

**Status: COMPLETED**

- Inspected admission create/decision/allocation/check-in/out service logic, routes and staff UI, complaint update workflow, visitor status transitions, inventory endpoints, relevant DTOs/tests, and documented phase scope.
- Owner selected one active admission per resident. Creation now locks the active resident row inside a transaction, rejects another non-deleted admission in PENDING, APPROVED, or CHECKED_IN, and allows a new admission after REJECTED, CHECKED_OUT, or CANCELLED. This serializes concurrent creates without a schema migration.
- Active bed allocations already have partial unique indexes on bed, resident, and admission while `ended_at IS NULL`; service tests and the PostgreSQL integration suite verify duplicate active allocation rejection. The integration suite also verified concurrent admission creation: exactly one request succeeds and one active admission persists.
- Owner chose no edit/cancel expansion; admissions continue to expose create, approve/reject, allocation, check-in, and check-out only.
- Complaints support assignment and status/priority updates through closure; no archive/delete route was found. Visitor registration, approval/rejection, and gate transitions exist; visitor update/delete routes were not found. Inventory routes cover setup/listing, not update/delete. The reviewed README does not approve expanding those scopes, so no additional CRUD was implemented.
- Tests: all backend unit tests passed (19 suites, 124 tests), including active-admission behavior; admissions, complaints, visitors, and inventory focused suites previously passed.
- **Scope boundary:** no additional admission edit/cancel, inventory update/delete, or complaint/visitor archive/delete features were added because they were not approved. The reviewed/approved admission and allocation rules are implemented and PostgreSQL-tested.
- **Files changed:** `backend/src/modules/residents/admissions.service.ts`, `backend/src/modules/residents/admissions.service.spec.ts`, `progress.md`.

## Task 6 — Search, Filters, Pagination & UI Verification

**Status: PARTIALLY COMPLETED**

- Inspected approved starter-scope documentation and current APIs/UI. Platform tenant/user/audit tables have search, filtering, and pagination; visitor history supports name/phone/CNIC search; finance reports have date filters and bounded outstanding-invoice output. Other scoped lists are bounded and no approved search/pagination requirement was found, so no additional features were added.
- Loading, empty, and error states are present in the staff and platform workspaces. Responsive CSS rules are present.
- Fixed overdue finance totals to compare invoice due timestamps against tenant-local midnight using the tenant's configured IANA timezone instead of the PostgreSQL session's `CURRENT_DATE`. Added a regression assertion that the report SQL applies the tenant timezone.
- Tests/builds: finance service tests passed (11); backend typecheck and focused lint passed. Frontend tests passed (3 suites, 14 tests), typecheck, lint, and production build passed.
- Browser: `/system-admin` rendered and client-side redirected an unauthenticated request to `/platform-admin/login`. The login page previously rendered at 390px and 1280px without horizontal overflow. Authenticated browser workflows and data/error states remain unverified because no authorized account is available.
- Added a PostgreSQL integration assertion for Asia/Karachi local-midnight overdue boundaries; strict comparison correctly leaves an invoice due exactly at local midnight not overdue.
- **Remaining blocker:** authenticated/data-backed browser workflows and local load test require authorized tenant-user credentials.
- **Files changed:** `backend/src/modules/finance/finance.service.ts`, `backend/src/modules/finance/finance.service.spec.ts`, `progress.md`.

## Task 7 — Integration Tests & CI

**Status: PARTIALLY COMPLETED**

- Inspected `jest.integration.config.js`, the dedicated test Compose file, PostgreSQL RLS integration suite, Prisma migrations, and CI integration job. The Jest config exists and targets only `test/integration/**/*.spec.ts`; the CI job already provisions PostgreSQL 16/Redis, migrates the disposable `hms_test` database, creates/grants the non-bypass runtime role, and invokes `npm run test:integration`. No CI workflow change was needed.
- Extended the PostgreSQL suite with tenant-scoped user lookup and resident/admission/allocation/payment/refund reads, database uniqueness checks for active allocations and payment/refund submission keys, and concurrent admission creation coverage. Fixtures use generated IDs and cleanup is limited to the dedicated test database. The suite explicitly un-mocks Prisma so it connects to the generated real client.
- Tests: the disposable PostgreSQL 16 database and existing HMS database now have all 14 migrations applied. The prior 14-test integration pass is retained as historical evidence; latest focused platform-admin integration passes 4/4, while the latest full integration command has two tenant-suite transaction-startup failures (admission concurrency and follow-on pooled transaction). Backend unit tests pass 19 suites / 124 tests.
- Added auth integration coverage and changed CI to assert the runtime role's least-privilege table grants instead of broadly re-granting DELETE on all tables. Parsed the workflow YAML locally; GitHub-hosted CI execution remains unverified.
- **Remaining blockers:** CI-hosted execution is unverified. The first admin now exists, but first-login MFA enrollment and authenticated browser workflows remain. Live payment/refund UI flows need an authorized tenant user.
- **Files changed:** `backend/test/integration/tenant-rls.spec.ts`, `backend/test/integration/platform-admin-auth.spec.ts`, `docker-compose.test.yml`, `.github/workflows/ci.yml`, `backend/prisma/migrations/20261027000002_platform_admin_tenant_rls/migration.sql`, `progress.md`.

## Additional Risks — Audit and Resolve

**Status: PARTIALLY COMPLETED**

- Redis is configured as a required application setting and Docker Compose service, but no BullMQ queue/processor registration exists. `backend/src/worker.ts` is an explicit Phase 0 placeholder that keeps a process alive; retries, failure recovery, and queue monitoring are not implemented. No approved background-job scope was found, so no jobs were invented.
- The backup script includes PostgreSQL and object-storage exports, but encryption is optional and no backup schedule was found. The owner chose to defer retention, so automatic cleanup remains disabled. Fixed its cleanup filter so a future approved duration only targets the script's top-level HMS backup artifact names; it no longer deletes unrelated files in `BACKUP_DIR`.
- `npm run test:restore-smoke` passed using an isolated disposable PostgreSQL container and synthetic data. This does not restore HMS application or object-storage backups and does not verify the 15-minute RPO or 4-hour RTO.
- The local load-test script is restricted to localhost and its syntax passed validation. It requires a seeded account, is capped at 100 requests/second and 60 seconds, and does not test 300 concurrent users. It was not run because no authorized test credentials were available; production-scale performance remains unverified.
- Inspected the room-capacity migration: it adds a 1–10 constraint as NOT VALID and then validates it; the preflight found zero existing out-of-range rooms. The visitor-CNIC migration is additive and nullable for legacy records, while new visitor DTO validation requires a CNIC. All 14 migrations are applied to the disposable test database and the existing HMS database. Aggregate-only review found one existing visitor record without the new encrypted CNIC/fingerprint fields; it was preserved.
- Tests: isolated restore smoke passed; `node --check` passed for both load/restore scripts; backup script Bash syntax and a temporary-directory retention-scope check passed.
- **Remaining blockers/decisions:** determine whether policy requires action for the one legacy visitor record without CNIC; no value can be backfilled without verified source data. Backup scheduling/encryption policy remains unresolved. Retention remains intentionally deferred by owner choice. No 300-CCU, real application-data restore, backup cadence, RPO/RTO, or production performance certification is claimed.
- **Files changed:** `infrastructure/scripts/backup.sh`, `progress.md`.

## Focused Super Admin Requirements Audit (2026-10-27)

Scope is limited to the seven Super Admin requirements in the latest request. The three pending migrations and additive platform-admin tenant-RLS migration were applied to the existing HMS database after preflight and protected backup; no reset or destructive migration was used.

| Requirement | Status | Audit result and remaining work |
|---|---|---|
| 1 — Super Admin dashboard | PARTIALLY COMPLETED | Dashboard statistics and protected API are implemented. PostgreSQL HTTP tests verify dashboard counts after tenant creation. Browser route redirects to login; real admin dashboard UI remains unverified until operator bootstrap. |
| 2 — Tenant/hostel management | PARTIALLY COMPLETED | PostgreSQL HTTP tests cover listing, detail, create, update, activate/suspend/reactivate, dashboard counts, and audit entries. API and all 14 migrations are deployed. Authenticated browser workflows await operator bootstrap. |
| 3 — Platform user management | PARTIALLY COMPLETED | PostgreSQL HTTP test covers tenant-user listing/deactivation and token-version increment. Role assignment and invalid-role rejection remain unit-tested; authenticated browser workflows await bootstrap. Platform-admin lifecycle remains operator/bootstrap-only by decision. |
| 4 — Authentication & authorization | PARTIALLY COMPLETED | Bootstrap can defer MFA, but first password login then requires MFA enrollment; no platform access token is issued until a valid authenticator code completes enrollment. Enrollment tokens are short-lived, scope-limited, and unusable for dashboard access; replay is denied. Focused PostgreSQL tests cover this flow, existing MFA/recovery login, token-scope rejection, anonymous denial, and inactive-admin denial. Updated API/UI are deployed; first app admin is created and the password-only start of the required MFA enrollment was verified. |
| 5 — Multi-tenant security | **COMPLETED** | Existing HMS `hms_app` runtime role is non-superuser/NOBYPASSRLS. Live tenant-scoped reads/CRUD, cross-tenant read/write denial, missing-context denial, and invalid-platform-context denial were verified. The additive policy permits tenant registry read/write only for active platform-admin context; inactive context is integration-tested and tenant deletion remains ungranted. |
| 6 — Audit logs & error handling | PARTIALLY COMPLETED | PostgreSQL HTTP tests verify tenant lifecycle and tenant-user access audit events. Validation/error behavior and no-secret audit metadata are unit-tested. Further browser confirmation/error-state checks require bootstrap. |
| 7 — Testing & verification | PARTIALLY COMPLETED | Backend unit tests: 19 suites / 124 passed; PostgreSQL integration tests: 14 passed; backend typecheck/lint and API image build passed. CI workflow YAML and least-privilege checks passed locally, but hosted GitHub Actions has not run. Browser was checked unauthenticated only. |

### Changes made for this focused audit

- Fixed tenant-scoped user-count queries in `backend/src/modules/platform-admin/platform-admin.service.ts` to run sequentially within the shared RLS transaction context.
- Rejected empty tenant and tenant-user access updates with explicit `BadRequestException`s.
- Added explicit tenant suspension/reactivation and user-access confirmation prompts in `frontend/src/components/platform-admin-workspace.tsx`.
- Added service tests for empty update rejection, audited suspension, blocked reactivation of closed tenants, and serial tenant scopes; added TenantGuard tests proving every non-ACTIVE tenant state is denied.
- Rebuilt and redeployed the API after applying the pending migrations. API readiness is HTTP 200; an empty platform login POST returns HTTP 400 rather than 404; dashboard without a token returns HTTP 401. Focused platform-admin unit tests passed (3 suites / 19 tests); the final backend suite passed 19 suites / 124 tests and PostgreSQL integration passed 14 tests. Migration status is up to date; `hms_app` is confirmed non-superuser/NOBYPASSRLS with least-privilege tenant grants.

### Deployment update and remaining blocker

- The pending migrations have been reviewed, the encrypted DPAPI backup verified, and the migrations applied. `prisma migrate status` reports all 13 migrations up to date.
- The rebuilt API is healthy and `/api/v1/platform/admin/auth/login` is no longer 404 (empty body returns 400 validation); all platform-admin tables exist. The database runtime role is `NOSUPERUSER NOBYPASSRLS`.
- The first platform-admin account was created after user request as `admin@example.test`; password was supplied privately in chat only and is not stored in project documentation. Its first-login MFA enrollment is pending; no platform access token has been issued. PostgreSQL HTTP integration tests exercised authorized management APIs with disposable test-admin identities.
- Owner decision recorded: platform-admin lifecycle remains operator/bootstrap-managed only. No dashboard API for creating or deactivating platform-admin identities was added; the interactive bootstrap flow remains the approved process.

**Files changed in this focused task:** `backend/src/modules/platform-admin/platform-admin.service.ts`, `backend/src/modules/platform-admin/platform-admin.service.spec.ts`, `backend/src/common/guards/tenant.guard.ts`, `backend/src/common/guards/tenant.guard.spec.ts`, `frontend/src/components/platform-admin-workspace.tsx`, `.gitignore`, `progress.md`, `gap.md`, `memory.md`.
