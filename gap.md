# gap.md — HMS Gap List (updated session 2)

**Last updated:** 2026-10-27 (remaining-task review and verification)
**Status key:** Open · In Progress · Built (tests pass) · Verified (evidence) · Blocked

## CODE rows (phase tracker)

| ID | Gap | Status | Note |
|---|---|---|---|
| CODE-01 | G-10 residuals in BDR §12 and PRD §24 | Open | Cleanup pass needed |
| CODE-02 | No application code — Phase 0 now done | **Built** | 14/14 tests pass |
| CODE-03 | ZIP not in sync with later edits | Open | Rebuild after Phase 1 |
| CODE-04 | Phase 0 (foundation) | **Built ✅** | 14 tests pass; ZIP at /home/claude/HMS_Phase0.zip |
| CODE-05 | Phase 1 (auth, scope, RBAC) | **Built ✅** | 46 tests total at Phase 1 completion |
| CODE-06 | Phase 2 (core domain) | **Verified ✅** | Inventory, residents, admissions, bed lifecycle, staff workflows, and public hostel pages implemented; all unit tests pass and the seeded local API workflow completed through check-out with bed release |
| CODE-07 | Phase 3 (finance) | **Verified ✅** (CODE-06) | Completed against user-confirmed starter scope: flexible staff-created invoices, manual payment recording/review, verified credits, refunds, finance reports/CSV, and safe void-and-reissue. Automated gateway/late fees/recurring invoices/proof-file uploads excluded; obtain formal sign-off before changing scope. |
| CODE-08 | Phase 4 (mess, complaints, notices) | **Verified ✅** (CODE-07) | Confirmed starter scope: weekly menus, submitter-tracked complaints with staff assignment/status, and dated branch notices. API/UI, additive migration, tests, live role workflows, and browser workspace verified. |
| CODE-09 | Phase 5 (gate ops) | **Verified ✅** | Confirmed manual visitor workflow: registration, Warden approval/rejection, Security check-in/out, searchable history; G-08 biometrics and G-21 hours/retention policy decisions remain deferred |
| CODE-10 | Phase 6 (offline/sync, lifecycle) | **In Progress** | Aggregate dashboard counts are cached per user/branch in session storage, read-only and without queued writes. Synthetic PostgreSQL restore smoke passed again, but does not validate HMS application backup/object-store recovery. Owner chose to defer retention; no cleanup is enabled by default. |
| CODE-11 | Phase 7 (hardening readiness) | **Verified ✅ — agreed local scope only** | Prior authenticated localhost benchmark reported 99.98 achieved RPS and 60.65 ms p95; this run did not repeat load or browser-offline tests. Current backend/frontend builds, lint, and tests passed. No production-like certification, 300-CCU test, or real HMS application-data restore is claimed. |
| CODE-12 | Phase 8 (pilot) | **Open** | Production rollout, 300-CCU verification, RPO 15-minute/RTO 4-hour recovery certification, and operational acceptance remain out of scope until separately approved. |
| CODE-13 | Platform administrator | **Account created; first-login MFA enrollment pending** | Updated frontend/API deployed and all 14 migrations applied. The active `admin@example.test` account was created on user request; password provided directly to user and omitted from project files. First password login returns required MFA setup with no access token until verification. |

## Latest remaining-task execution (2026-10-27)

| Task | Status | Verified work | Remaining |
|---|---|---|---|
| 1 — RLS & tenant isolation | **COMPLETED** | 14 PostgreSQL HTTP/integration tests pass on isolated `hms_test`; live HMS `hms_app` checks verified tenant isolation, cross-tenant read/write denial, no-context denial, and synthetic CRUD. Runtime role is `NOSUPERUSER NOBYPASSRLS`. | Hosted CI execution remains unverified |
| 2 — DB & migrations | Partially completed | All 14 migrations applied to the existing HMS DB; preflight found no orphan reset tokens, missing reset-token tenants, or invalid room capacities; protected backup verified | One legacy visitor record lacks encrypted CNIC/fingerprint data and was preserved; broader persistence workflows remain unverified |
| 3 — Payments/refunds | Partially completed | Form retention/idempotency tests pass; migration applied on disposable DB and existing HMS DB; payment/refund unique keys verified in integration suite | Live payment/refund retry workflow remains to be verified against HMS data |
| 4 — Super Admin | Partially completed | Updated API/UI deployed; PostgreSQL HTTP tests cover dashboard, tenant lifecycle, audit, user deactivation, unauthorized/inactive-admin denial, and deferred MFA enrollment. Active app admin exists; password login is verified to require MFA before issuing a token. | Complete MFA enrollment, then run authenticated browser checks |
| 5 — Admissions/CRUD | **COMPLETED** | Owner-approved one-active-admission rule, active-allocation uniqueness, and concurrent admission race verified against PostgreSQL | Unapproved edit/cancel and additional inventory/complaint/visitor CRUD were intentionally not implemented |
| 6 — Search/UI/timezone | Partially completed | Existing search/filter/report UI reviewed; overdue calculation uses tenant-local midnight; responsive login checked | Authenticated/data-backed UI and database overdue boundary verification |
| 7 — Integration/CI | Partially completed | CI provisions a disposable DB; all 14 migrations apply; focused platform-admin PostgreSQL tests pass 4/4; least-privilege assertions are present | Latest full PostgreSQL run has two tenant-suite transaction-startup failures; hosted CI execution remains unverified |
| Additional risks | Partially completed | Synthetic restore smoke passed; backup cleanup narrowed to HMS artifacts | No BullMQ processors/retries; backup schedule/encryption, RPO/RTO, and production scale unverified |

Latest validation: backend 19 suites / 124 unit tests passed; focused platform-admin PostgreSQL integration tests: 4 passed; backend typecheck, lint, and production build passed. Frontend 3 suites / 14 tests, typecheck/lint, and production build passed. All 14 migrations are applied to both the isolated test database and existing HMS DB. Full PostgreSQL integration currently fails in two tenant admission/context tests; platform-admin integration passes independently. Updated API and frontend are healthy; readiness is HTTP 200, login page HTTP 200, and anonymous dashboard access HTTP 401. `hms_app` is `NOSUPERUSER NOBYPASSRLS` with least-privilege grants. Previous live tenant RLS denial and synthetic tenant CRUD checks passed. Backup retention is intentionally deferred by owner choice.

## Key blockers

| ID | Blocker | Blocks |
|---|---|---|
| BLK-05 | Owner decisions G-01, G-02, G-05, G-06, G-09, G-17 | Phase 1+ |
| BLK-DB | No pending migrations; one legacy visitor record lacks encrypted CNIC/fingerprint data and broader legacy workflows remain unverified | Task 2 legacy-data acceptance |
| BLK-DEPLOY | No remaining stale-backend or route-404 blocker; the first platform admin has not been bootstrapped | Task 4 authenticated Super Admin acceptance |
| BLK-OPS | Backup retention deferred by owner; schedule/encryption policy unresolved; worker has no processors | Additional risks, production readiness |
| BLK-SCOPE | No approval for admission edit/cancel, inventory update/delete, or complaint/visitor archive/delete | Task 5 scope expansion |
| BLK-01 | Approved PRD/SRS V2 (now resolved — uploaded session 2) | BASE-01 ✅ |
| BLK-02 | Developer Handover v2 | Every ✅ tag |
| BASE-01 | Baseline values | ✅ Confirmed by SRS V2: 200 tenants, 100k residents, 300 CCU, 100 rps, p95 ≤ 500ms, RPO 15min, RTO 4h, PKR, Asia/Karachi |

## Phase 0 decisions made (proposed, not owner-approved)

- PostgreSQL + Redis + NestJS + Next.js (G-02/OD-13)
- Shared DB + tenant_id NOT NULL + RLS (G-01)
- Asia/Karachi timezone, PKR currency (G-04)
- RLS enabled on all tenant tables; app credentials must NOT have BYPASSRLS
- Migration: 20261015000000_phase0_foundation

## Remaining open items from original gap.md

All B-K rows from the original gap.md remain open. See session 1 gap.md for the full list.
This file records only Phase 0 changes. Merge the full list before Phase 1.
