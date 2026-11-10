# gap.md — HMS Gap List

**Last updated:** 2026-11-02 (local implementation and verification)
**Status key:** Open · In Progress · Built (tests pass) · Verified (evidence) · Blocked

## CODE rows (phase tracker)

| ID | Gap | Status | Note |
|---|---|---|---|
| CODE-01 | G-10 residuals in BDR §12 and PRD §24 | **Blocked** | The BDR and PRD source documents are not present in this workspace; do not infer or rewrite their §12/§24 requirements. |
| CODE-02 | No application code — Phase 0 now done | **Built** | 14/14 tests pass |
| CODE-03 | ZIP not in sync with later edits | **Completed locally** | A fresh `HMS_Phase1.zip` is created from the current workspace source; see archive exclusions and verification below. |
| CODE-04 | Phase 0 (foundation) | **Built ✅** | 14 tests pass; ZIP at /home/claude/HMS_Phase0.zip |
| CODE-05 | Phase 1 (auth, scope, RBAC) | **Built ✅** | 46 tests total at Phase 1 completion |
| CODE-06 | Phase 2 (core domain) | **Verified ✅** | Inventory, residents, admissions, bed lifecycle, staff workflows, and public hostel pages implemented; all unit tests pass and the seeded local API workflow completed through check-out with bed release |
| CODE-07 | Phase 3 (finance) | **Verified ✅** (CODE-06) | Completed against user-confirmed starter scope: flexible staff-created invoices, manual payment recording/review, verified credits, refunds, finance reports/CSV, and safe void-and-reissue. Automated gateway/late fees/recurring invoices/proof-file uploads excluded; obtain formal sign-off before changing scope. |
| CODE-08 | Phase 4 (mess, complaints, notices) | **Verified ✅** (CODE-07) | Confirmed starter scope: weekly menus, submitter-tracked complaints with staff assignment/status, and dated branch notices. API/UI, additive migration, tests, live role workflows, and browser workspace verified. |
| CODE-09 | Phase 5 (gate ops) | **Verified ✅** | Confirmed manual visitor workflow: registration, Warden approval/rejection, Security check-in/out, searchable history; G-08 biometrics and G-21 hours/retention policy decisions remain deferred |
| CODE-10 | Phase 6 (offline/sync, lifecycle) | **Partially implemented locally** | Aggregate dashboard counts remain read-only; student complaint submissions now queue per user/branch in session storage and replay with an idempotency key. Other staff writes remain blocked offline. No full offline/browser acceptance or real HMS application/object-store restore is claimed. Retention remains deferred; no purge is enabled. |
| CODE-11 | Phase 7 (hardening readiness) | **Verified — local code checks only** | Local unit/integration tests, typechecks, lint, Prisma validation, production builds, and isolated synthetic PostgreSQL restore passed. Prior local benchmark evidence is historical and was not repeated. No production-like certification, 300-CCU test, or real HMS application-data restore is claimed. |
| CODE-12 | Phase 8 (pilot) | **Deferred by scope** | User selected local-only work. Production rollout, 300-CCU verification, RPO 15-minute/RTO 4-hour recovery certification, and operational acceptance were not run. |
| CODE-13 | Platform administrator | **MFA enrollment pending** | Prior project notes record the admin account as active and first-login MFA enrollment required. No authenticated browser session or live account access was used in this local-only task. |
| CODE-14 | Phase 5 scalability and refactoring | **Implemented locally; deployment/backfill pending** | Tenant-scoped PDF/proof operations, private S3 proof storage, an additive migration/backfill, per-process DB connection limits, queue retries, and shared connectivity hook are in source. No tests or performance certification were run. |

## Historical remaining-task execution (2026-10-27)

| Task | Status | Verified work | Remaining |
|---|---|---|---|
| 1 — RLS & tenant isolation | **COMPLETED** | 14 PostgreSQL HTTP/integration tests pass on isolated `hms_test`; live HMS `hms_app` checks verified tenant isolation, cross-tenant read/write denial, no-context denial, and synthetic CRUD. Runtime role is `NOSUPERUSER NOBYPASSRLS`. | Hosted CI execution remains unverified |
| 2 — DB & migrations | Partially completed | The new additive complaint-idempotency/archive migration was applied successfully to a fresh, isolated disposable `hms_test` database; integration tests passed. No persistent HMS database was accessed. | Apply only with explicit authorization to the intended persistent database; one legacy visitor record lacks encrypted CNIC/fingerprint data; broader real-data workflows remain unverified. |
| 3 — Payments/refunds | Partially completed | Existing UI/service idempotency paths and unit tests remain in place; full local backend tests pass. | No live HMS payment/refund retry was performed under local-only scope. |
| 4 — Super Admin | Partially completed | Previous API/UI and PostgreSQL test evidence remains historical. | Complete MFA enrollment and authenticated browser checks require the admin/user and an authorized environment. |
| 5 — Admissions/CRUD | **Implemented locally** | Added pending-only admission edit/cancel; inventory edit and dependency-checked soft archive; resolved/closed complaint archive; rejected/checked-out visitor archive; permissions, audit events, and focused unit tests. | Migration not applied to a database; no authenticated end-to-end/real-data test performed. |
| 6 — Search/UI/timezone | Partially completed | Existing search/filter/report UI remains; approved CRUD controls are now exposed in the staff workspace. | Authenticated/data-backed UI and database overdue boundary verification need an authorized test environment. |
| 7 — Integration/CI | Partially completed | Latest isolated local PostgreSQL integration run passed 15/15 tests, including tenant isolation, concurrent admissions, and overdue-boundary checks. The two failures noted in the earlier run were not reproduced. | Hosted CI was not run; retain monitoring for those historical intermittent failures. |
| Additional risks | Partially completed | Synthetic restore evidence is historical; local backup preflight remains non-destructive; retention cleanup remains disabled. | No BullMQ processors/retries; backup schedule/encryption/key policy, application-data restore, RPO/RTO, and production scale remain unverified or undecided. |

Latest local validation: backend 20 suites / 154 unit tests passed; backend typecheck, lint, and production build passed. Frontend 6 suites / 23 tests passed; frontend typecheck, lint, and production build passed. Prisma schema validation passed without connecting to a database. A fresh disposable PostgreSQL `hms_test` database received all migrations and passed 15/15 integration tests; the isolated synthetic PostgreSQL dump/restore smoke also passed. The new migration remains unapplied to any persistent HMS database. No live/production database, authenticated browser account, hosted CI, production service, or real-application-data backup/restore was accessed in this run.

### CODE-03 archive verification

`HMS_Phase1.zip` is at the workspace root, beside the `hms/` source directory. It contains the current project source and documentation. Packaging excludes `.git`, `.env` and other environment files (retaining `.env.example`), dependency directories, generated builds, coverage, and cache output. The archive was inspected to confirm required source files are present and excluded paths/secrets are absent.

## Key blockers

| ID | Blocker | Blocks |
|---|---|---|
| BLK-05 | Owner decisions G-01, G-02, G-05, G-06, G-09, G-17 | Phase 1+ |
| BLK-DB | New local migration is not applied to a persistent HMS database; one legacy visitor record lacks encrypted CNIC/fingerprint data and broader real-data workflows remain unverified | Authorized persistent migration and legacy-data acceptance |
| BLK-DEPLOY | MFA enrollment and authenticated acceptance are pending; historical notes conflict on bootstrap status | CODE-13; Task 4 authenticated Super Admin acceptance |
| BLK-OPS | Backup retention deferred by owner; schedule/encryption policy unresolved; worker has no processors | Additional risks, production readiness |
| BLK-SCOPE | User approved bounded local CRUD; biometrics are excluded, visitor hours and retention are deferred, and physical record deletion remains disabled | G-08/G-21 and policy-dependent cleanup |
| BLK-PROOF-STORAGE | Additive object-storage migration and legacy-proof backfill are not applied; production private bucket, credentials, and retention/backup policy must be configured | Payment-proof rollout and removal of legacy database bytes |
| BLK-SCALE | 200+ tenants, 100,000 residents, 300 concurrent users, 100 RPS, p95 500 ms, RPO 15 minutes, and RTO 4 hours are not certified | Production capacity and recovery readiness |
| BLK-01 | PRD/SRS V2 was previously noted as uploaded, but source files are absent from this workspace | G-10 source reconciliation |
| BLK-02 | Developer Handover v2 | Every ✅ tag |
| BASE-01 | Baseline values | ✅ Confirmed by SRS V2: 200 tenants, 100k residents, 300 CCU, 100 rps, p95 ≤ 500ms, RPO 15min, RTO 4h, PKR, Asia/Karachi |

## Phase 0 decisions made (proposed, not owner-approved)

- PostgreSQL + Redis + NestJS + Next.js (G-02/OD-13)
- Shared DB + tenant_id NOT NULL + RLS (G-01)
- Asia/Karachi timezone, PKR currency (G-04)
- RLS enabled on all tenant tables; app credentials must NOT have BYPASSRLS
- Migration: 20261015000000_phase0_foundation

## Scope decisions for this update

- Local code/tests only; no staging or production deployment, real database access, or production certification.
- Offline queue is limited to student complaint submissions. It uses session storage, retains failed entries with an error, and relies on server-side idempotency.
- Admissions may be edited/cancelled only while `PENDING`.
- Inventory records are soft-archived only after child records are archived; beds must be available and have no active allocation.
- Complaints may be archived only after resolution/closure. Visitor records may be archived only when rejected or checked out. These operations retain records and do not erase CNIC data.
- Biometrics are not approved. Visitor hours, retention duration, backup schedule/encryption policy remain deferred; no cleanup or purge is enabled.
- The original B-K gap list and the BDR/PRD source documents are absent from this workspace. Their contents and G-10 §12/§24 requirements cannot be reconstructed from this summary.

## Remaining gaps requiring external input or authorization

- Provide the BDR and PRD plus the original B-K gap list to finish G-10 and reconcile the complete tracker.
- Decide whether/when to apply the tested migration to a persistent HMS database; the two previously reported tenant integration failures passed in the latest disposable run but still need hosted-CI confirmation.
- Complete admin MFA enrollment and authenticated browser acceptance.
- Supply a verified source/policy for the legacy visitor record; do not fabricate identity fields.
- Approve backup schedule, encryption/key management, retention period, visitor hours, and whether physical deletion is ever permitted.
- Implement/verify BullMQ processors and retry policy against defined business jobs.
- Run hosted CI, browser/offline acceptance, live payment retry, application backup/object-store restore, RPO/RTO, 300-CCU and production pilot only with an authorized environment and acceptance plan.
