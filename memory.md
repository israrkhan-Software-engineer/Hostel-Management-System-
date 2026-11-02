# memory.md — HMS Session Handoff

**Last updated:** 2026-10-27 (deferred platform-admin MFA enrollment)

## Current handoff — 2026-10-27
The seven-task execution is documented in `progress.md` and `gap.md`. The platform-admin login 404 is resolved. Tenant RLS behavior and authorized management APIs are verified with live PostgreSQL checks and disposable PostgreSQL HTTP tests. Latest code now permits MFA enrollment to be deferred at bootstrap but mandates enrollment on first password login before issuing an access token.

- Backend final validation: 19 suites / 124 unit tests passed; focused platform-admin PostgreSQL integration tests: 4 passed; typecheck, lint, and production image build passed.
- Frontend final validation: 3 suites / 14 tests passed; typecheck, lint, and production build passed.
- An isolated disposable PostgreSQL 16 `hms_test` database was provisioned on port 25432. All 14 Prisma migrations were applied there. The latest full integration run had 13/15 tests pass and two existing tenant transaction-startup failures; the focused platform-admin file passes 4/4.
- A new migration, `20261027000003_platform_admin_deferred_mfa`, is applied to isolated `hms_test` and existing HMS DB; it allows a null MFA secret only for deferred setup, adds an encrypted pending-enrollment-secret field, and grants narrowly scoped recovery-code insertion. Existing platform-admin MFA secrets are unchanged. The updated focused platform-admin HTTP suite passes 4/4, covering deferred enrollment, enrollment-token authorization denial and replay rejection, and one-time recovery-code login.
- The existing HMS database has all 14 source migrations applied. Before earlier pending migrations, a DPAPI-protected backup was verified and read-only preflight found no orphan reset tokens, reset tokens without tenants, or rooms outside bed-capacity bounds. No reset or destructive migration was used for this additive schema update.
- The API was rebuilt and redeployed from current source. `/api/health/ready` returns HTTP 200; an empty POST to `/api/v1/platform/admin/auth/login` returns HTTP 400 validation rather than 404, and the dashboard without a token returns HTTP 401. All three platform-admin tables exist; `hms_app` is `NOSUPERUSER NOBYPASSRLS` with scoped tenant registry SELECT/INSERT/UPDATE grants and no tenant DELETE grant.
- Owner-approved duplicate-admission rule: one active admission per resident (PENDING, APPROVED, CHECKED_IN). Creation locks the active resident row in a transaction and rejects duplicate active admissions. Unit and real PostgreSQL concurrency tests pass; exactly one concurrent submission persisted.
- Owner chose not to add admission edit/cancel routes. Inventory update/delete and complaint/visitor archive/delete remain unapproved and unimplemented.
- Finance overdue totals now use configured tenant timezone to determine local midnight. The payment/refund idempotency migration is applied on both the disposable and HMS databases; integration tests verify payment/refund idempotency-key uniqueness. Live finance retry workflows on the HMS data remain unverified.
- Super Admin frontend and API are deployed from current source. PostgreSQL HTTP tests verify dashboard statistics; tenant list/detail/create/update/status/audit; tenant-user list/deactivation; and denial for anonymous, tenant-scoped, or inactive-admin access. Live `hms_app` checks verified cross-tenant read/write denial, missing-context denial, and synthetic tenant CRUD. The app platform admin `admin@example.test` is now created and active, with a unique generated password shared directly with the user, not saved in files. Real login was verified to return only an MFA-enrollment challenge and no access token; user must finish enrollment before dashboard access.
- One existing visitor row lacks the new encrypted CNIC/fingerprint fields. It was preserved; no identity data was fabricated or overwritten. A verified source record or explicit data policy is needed before resolving this legacy row.
- Synthetic PostgreSQL restore smoke passed in a disposable container; this is not an HMS application/object-storage restore and does not prove RPO/RTO.
- Backup cleanup is now restricted to top-level HMS backup artifact names. Owner explicitly chose to defer retention, so automatic cleanup remains disabled unless policy is approved. Backup scheduling/encryption policy is unresolved.
- No BullMQ processors/retries/monitoring are registered; `backend/src/worker.ts` is still a placeholder. Production 300-CCU, application backup recovery, RPO/RTO, and production-scale performance are not verified.
- Backend typecheck/lint and production image build passed after the integration fixes. Hosted GitHub Actions was not run; authenticated browser workflows, live HMS finance retries, real HMS app/object-storage restore, backup scheduling/encryption policy, RPO/RTO, worker processing, and production 300-CCU testing remain unverified or unresolved. See `gap.md` for blockers and `progress.md` for evidence and changed files. The protected migration backup remains encrypted to the current Windows user account.
- The latest complete PostgreSQL integration command reports failures in two pre-existing tenant-suite tests (admission concurrency transaction startup and a follow-on pooled transaction startup); the Super Admin integration suite passes independently. Do not report the entire integration suite as passing for the latest run.

## Project state
Phase 0: Built ✅ | Phase 1: Built ✅ | Phase 2: Verified ✅ | Phase 3: Verified ✅ (user-confirmed starter scope) | Phase 4: Verified ✅ (user-confirmed starter scope) | Phase 5: Verified ✅ (user-confirmed manual visitor scope) | Phase 6: In Progress | Phase 7: Verified ✅ (agreed local hardening scope) | Phase 8: Not started
Latest verification: backend production build, lint, typecheck pass; 19 suites / 124 unit tests pass; focused platform-admin PostgreSQL suite 4/4 passes. Frontend production build, lint, typecheck pass; 3 suites / 14 tests pass. The full PostgreSQL integration suite has the two unrelated tenant test failures noted above. Updated API and frontend containers are running healthy; readiness and login page return HTTP 200, anonymous dashboard returns HTTP 401.
The API Docker image builds, the local demo seed succeeds, and the authenticated API lifecycle passed end to end: login/profile/branch visibility, resident registration with masked CNIC, admission approval, bed allocation, check-in, check-out, and bed release.
Phase 3 is implemented and verified to the user-confirmed starter scope: invoices with multiple charge lines, manual payment review, balance/credit calculations, manual refunds, date-filtered finance/overdue reports with CSV export, and safe invoice voiding (void-and-reissue; cannot void invoices with non-rejected payments or refunds). Live API checks covered invoice/payment/refund/report/void; the Finance UI/report renders in-browser. User-confirmed exclusions: online gateway, automatic late fees, recurring billing, and uploaded proof files (reference/notes are supported). Obtain formal approval before expanding beyond this scope.
Phase 3 files: `backend/src/modules/finance/`, `backend/prisma/migrations/20261022000001_phase3_finance/migration.sql`, and the Finance tab in `frontend/src/components/phase2-workspace.tsx`.
Phase 4 starter scope confirmed and verified: weekly menus for breakfast/lunch/dinner; submitter-tracked complaints with staff ownership/status workflow; branch notices with draft/publish and optional visibility dates. API/schema/migration, seed permissions, and shared workspace UI are implemented and deployed. All 74 backend tests, 7 frontend tests, frontend typecheck, Docker builds, migration status, live API role workflows, and browser workspace inspection passed. Phase 4 paths: `backend/src/modules/phase4/`, `backend/prisma/migrations/20261022000002_phase4_mess_complaints_notices/migration.sql`, and Phase 4 tabs in `frontend/src/components/phase2-workspace.tsx`.
Phase 5 historical scope verification: manual visitor registration with Pakistani CNIC required for new registrations (encrypted/fingerprinted and masked), optional phone, purpose, and host resident; staff approval/rejection, gate check-in/out, searchable history. Security registers and handles gate movements; Warden approves. Biometrics (G-08), fees, visiting hours, and retention policy remain deferred; no automatic purge is configured. Later CNIC extension is described in `progress.md`; current PostgreSQL migration state is unverified.
Phase 6 confirmed scope is partially implemented: aggregate counts are cached in sessionStorage, partitioned by user and branch, with no PII, financial amounts, or queued writes; backup checking remains a configuration preflight, not an actual backup/restore test. No automatic retention cleanup is configured.
Phase 7 is verified for the agreed local hardening scope: global per-instance throttling is configurable (10,000 requests/minute by default to support the documented 100-rps baseline, with existing per-route auth limits), client IPs use the single nginx proxy hop, and backend/frontend lint plus Phase 7 script syntax checks run in CI. Local authenticated load test: 3,000/3,000 HTTP 200, 99.98 achieved RPS, p95 60.65 ms. Disposable synthetic PostgreSQL dump/restore smoke and browser offline-cache verification passed. Offline mode shows aggregate counts only, hides sensitive-data tabs, clears sensitive in-memory lists, blocks writes/sync, and suppresses transient offline fetch errors. The backup script now archives the actual Compose SeaweedFS object-storage volume; the API backup preflight clearly distinguishes API-runtime config from host-side Docker Compose workflow. Important limits: no real HMS application backup was restored, no production-like 300-CCU test or RPO/RTO certification was performed; no production deployment, live pilot, or retention-policy change.
Historical environment note: previous review found the stale Phase 0 `/system-admin` placeholder and an unreachable application database. The frontend was subsequently rebuilt and its unauthenticated login redirect verified. The existing app database remains unreachable; the worker source remains a no-job placeholder, regardless of process status.

## Codebase
`hms/` — project root

## Phase 2 implementation
backend/src/modules/inventory/ — branch-scoped buildings, floors, rooms, beds API
backend/src/modules/residents/ — resident records and admission/bed lifecycle API
backend/src/common/utils/field-encryption.util.ts — AES-GCM encryption, keyed CNIC fingerprint, masking
backend/prisma/migrations/20261022000000_phase2_residents_admissions/migration.sql
frontend/src/components/phase2-workspace.tsx — staff admission, resident, and inventory workflows
frontend/src/app/(public)/hostels/[slug]/page.tsx — public hostel contacts
Admission flow chosen for this implementation: staff create resident/admission → approve or reject → assign bed → check in/out.
CNIC is optional, encrypted at rest, deduplicated by tenant-keyed fingerprint, and only returned masked.
Login uses an in-memory access token and HttpOnly refresh cookie with single-flight refresh. Auth login/refresh/logout/reset routes are public; profile and staff APIs are authenticated.

## Phase 1 key files
backend/src/modules/auth/auth.service.ts       — login, refresh rotation, reset
backend/src/modules/auth/auth.controller.ts    — POST /api/v1/auth/{login,refresh,logout,reset-password}
backend/src/modules/auth/jwt.strategy.ts       — tokenVersion-based instant deactivation
backend/src/modules/auth/auth.module.ts
backend/src/modules/tenants/tenants.service.ts — tenant resolution, active/suspended check
backend/src/modules/users/users.service.ts     — find, create, deactivate, scope queries
backend/src/modules/roles/roles.service.ts     — permission checks, userHasPermission()
backend/src/modules/audit/audit.service.ts     — append-only audit log writer
backend/src/common/guards/jwt-auth.guard.ts    — L1 auth (global)
backend/src/common/guards/tenant.guard.ts      — L2 tenant + RLS context setter (global)
backend/src/common/guards/permission.guard.ts  — L4 permission (global)
backend/src/common/guards/branch-scope.guard.ts— L3 branch scope (per-route @BranchScoped)
backend/src/common/decorators/             — @Public, @RequirePermission, @BranchScoped, @CurrentUser
backend/src/common/utils/password.util.ts  — hash, verify, generateToken, hashToken
backend/prisma/schema.prisma               — + RefreshToken, PasswordResetToken
backend/prisma/migrations/20261016000000_phase1_auth/migration.sql
backend/prisma/seed.ts                     — 2 tenants × all 9 roles × 2 branches + deactivated user

## Phase 1 test files
backend/src/modules/auth/auth.service.spec.ts      — 16 tests (login, refresh, reuse, deactivation)
backend/src/common/guards/permission.guard.spec.ts — 10 tests (auth matrix spot-checks)
backend/src/common/utils/password.util.spec.ts     — 12 tests

## Build tracker
Phase 0: Built ✅ (14 tests)
Phase 1: Built ✅ (46 tests total; exit criteria met — see below)
Phase 2: Verified ✅ (APIs, staff workflows, public hostel page, seeded login, and API admission lifecycle verified)
Phase 3: Verified ✅ (confirmed finance scope and live API/UI validation)
Phase 4-8: Not started

## Phase 1 exit criteria (all met)
✅ Authorization matrix passes for all guard layers (permission.guard.spec)
✅ Deactivation immediately blocks API access (tokenVersion check in jwt.strategy)
✅ Refresh rotation + reuse detection tested
✅ Password reset: single-use, time-limited
✅ Seed dataset with every role + deactivated user + 2 tenants
✅ Global guard chain: JwtAuthGuard → TenantGuard → PermissionGuard
✅ RLS context set per request in TenantGuard

## Phase 3 follow-up (only if requirements expand)
1. Obtain formal owner sign-off on any additional G-06/G-17 requirements.
2. Add browser-automated coverage for invoice/payment UI; finance lifecycle was verified against the API and report rendering was inspected in-browser.
3. Implement authenticated proof-file uploads, recurring billing, or online payments only if added to the approved scope.

## Other follow-up
1. Add browser-level end-to-end coverage for staff sign-in and the complete admission lifecycle; current lifecycle verification used the authenticated API.
2. Continue hardening local Compose storage credentials.

## Resume prompt
Read this handoff and the Phase 3 requirements before starting further development. Do not expose local environment credentials.
