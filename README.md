# Hostel Management System (HMS)

Multi-tenant SaaS platform for hostel operations — residents, billing, gate, mess, complaints and reporting.

**Phase 0 — Foundation & Environment (complete)**  
**Phase 1 — Auth, RBAC & scope resolution (complete)**  
**Phase 2 — Core domain (complete):** inventory, residents, admissions, bed allocation, check-in/out, staff workflows, and public hostel pages.
**Phase 3 — Finance (complete for the user-confirmed scope):** manual invoices, payment verification, balances/credits, refunds, finance reporting, and PDF downloads of issued invoices.
**Phase 4 — Mess, Complaints, and Notices (complete for the confirmed starter scope):** weekly menus, complaint tracking, and branch-wide notices.
**Phase 5 — Gate Operations:** visitor registration, staff approval, gate check-in/out, and visit history. New registrations require Pakistani CNIC; CNIC is encrypted at rest and returned/searchable only in masked/fingerprint form. Existing records remain readable without a CNIC.
**Phase 6 — Offline sync & backup verification (partially complete):** aggregate dashboard counts are cached in the active browser session in read-only mode; personal details and financial amounts are excluded. A synthetic PostgreSQL restore smoke exists, but application backup/restore is not verified.
**Phase 7 — Hardening readiness (complete for the agreed local scope):** global API throttling, CI checks, offline browser verification, local 100-rps benchmark, and isolated synthetic PostgreSQL restore smoke test are complete. Production-like certification and an application-data restore remain unverified; no production deployment or owner-policy changes.
**Phase 8 — Pilot (not started):** production-like rollout and operational acceptance remain separate from local hardening.

Phase 2 uses staff-created admissions that require approval before a bed can be assigned. CNIC values are encrypted at rest and only returned masked.

---

## Stack (proposed 🟡 — pending G-02/OD-13 approval)

| Layer | Technology |
|---|---|
| Frontend / PWA | Next.js 14 (App Router) + React + TypeScript |
| Backend API | NestJS + TypeScript |
| Database | PostgreSQL 16 + Prisma ORM + RLS |
| Cache / Queue | Redis 7 + BullMQ |
| Object storage | SeaweedFS (S3-compatible local development) |
| Reverse proxy | nginx |
| CI | GitHub Actions |

---

## Quick start

```bash
# 1. Create an ignored local env file and replace its development secrets
Copy-Item .env.example .env

# 2. Start the local development stack (HTTP reverse proxy on port 8080)
docker compose up --build -d

# 3. Open the app; migrations run automatically before the API starts
http://localhost:8080

# 4. Optional: create local demo tenants and staff accounts (development only)
docker compose exec api npm run db:seed
```

The local Compose stack uses SeaweedFS as its S3-compatible development object store and an HTTP-only, localhost-bound nginx proxy. Do not use the development environment or proxy configuration in production.
The seed command creates development-only users with simple passwords; never run it against production data.
After seeding, sign in locally with `owner@sunrise-hostel.demo`, password `Demo1234!`, and tenant slug `sunrise-hostel`. These credentials are for local development only.

---

## Running tests

```bash
# Backend unit tests
cd backend && npm test

# Frontend unit tests
cd frontend && npx jest --config jest.config.js

# Both
cd backend && npm test && cd ../frontend && npx jest --config jest.config.js
```

---

## Phase 0 exit criteria (all met ✅)

- [x] `docker compose up` yields a healthy stack (nginx + api + frontend + postgres + redis + local S3-compatible storage)
- [x] Base schema migrated in CI (`prisma/migrations/20261015000000_phase0_foundation/migration.sql`)
- [x] Backend unit tests pass: 8/8
- [x] Frontend unit tests pass: 6/6
- [x] No secrets in repo (`.env.example` only; all values are placeholders)
- [x] RLS enabled on all tenant-scoped tables — application credentials must NOT have BYPASSRLS
- [x] CI workflow scaffolded (`.github/workflows/ci.yml`)

---

## Key decisions made (proposed defaults, pending owner sign-off)

| Decision | Proposed value | Gap ref |
|---|---|---|
| Database engine | PostgreSQL 16 | G-02 / OD-13 |
| Tenancy | Shared DB + `tenant_id` NOT NULL + RLS | G-01 |
| Timezone | Asia/Karachi | G-04 / OD-08 |
| Currency | PKR | G-04 / OD-08 |
| Backup retention | Policy-driven — owner must set | G-09 / OD-06 |
| MFA scope | Optional for privileged roles | G-05 / OD-32 |
| Online payment | Manual proof only until G-07/OD-01 decided | G-07 |

---

## Open owner decisions

- Confirm owner approvals for G-01 (tenancy), G-02 (stack), and G-05 (MFA scope)
- Tenant URL scheme decided (slug / subdomain — OD-14)
- SAAS-01 to SAAS-05 gap rows drafted

See `gap.md` for the full open-decision register.

## Phase 2 (complete)

Authenticated endpoints are branch-scoped under `/api/v1/branches/:branchId`:

- `GET/POST inventory/buildings`, `POST inventory/floors`, `GET/POST inventory/rooms`, `GET/POST inventory/beds`
- `GET/POST residents`, `GET/PATCH/DELETE residents/:residentId`
- `GET/POST admissions`, `PATCH admissions/:admissionId/decision`
- `GET admissions/available-beds`, `POST admissions/:admissionId/allocation`
- `POST admissions/:admissionId/check-in` and `POST admissions/:admissionId/check-out`
- `GET /api/v1/branches` returns only active branches the signed-in staff member can access
- `GET /api/v1/auth/profile` returns the current user’s role and permission codes
- `GET /api/v1/public/hostels/:slug` returns public hostel and active branch contact details only

The staff workspace at `/login`, `/reception`, `/warden`, and `/owner` supports sign-in with silent refresh, branch selection, resident registration, admission creation and review, bed assignment, check-in/out, and inventory setup. Public pages are available at `/home` and `/hostels/:slug`; they do not expose resident or admission records. Admission approval is required before bed assignment, and CNIC values are encrypted at rest and only returned masked.

Bed assignment is conditional and transactional; room bed capacity and active bed uniqueness are enforced. The local Docker Compose stack was verified running and accessible through nginx at `http://localhost:8080`; PostgreSQL, Redis, API, and frontend readiness checks pass, and the worker remains running.

Validation: backend build and all 59 unit tests pass; frontend type-check and all 7 API-client tests pass. The API Docker image builds with the seed command included, and the local seed command creates both demo tenants. The authenticated API workflow was exercised end to end: login/profile/branch visibility, resident creation with masked CNIC, admission approval, bed allocation, check-in, check-out, and bed release. The local Compose stack remains healthy and accessible through nginx.

## Phase 3 (complete for the user-confirmed scope)

The initial finance slice adds tenant- and branch-scoped issued invoices with multiple charge lines, manual payment records requiring staff verification, balance/credit calculations, and manual refund records. Monetary values are stored as integer minor units in the tenant's currency. Accountant demo accounts can view residents for billing, issue invoices, record payments, verify payments, and approve refunds according to their seeded permissions. The user confirmed these starter defaults; the workspace does not contain enough detail to assert that all G-06/G-17 requirements are resolved.

Finance API routes are under `/api/v1/branches/:branchId`:

- `GET finance-report?from=YYYY-MM-DD&to=YYYY-MM-DD` returns period collections, issued totals, pending amounts, outstanding and overdue balances, and up to 100 outstanding invoices; the summary includes all matching invoices
- `GET/POST invoices`, `GET invoices/:invoiceId`
- `GET invoices/:invoiceId/pdf` downloads a tenant- and branch-scoped PDF generated from the existing invoice and payment records; repeated downloads do not create invoices.
- `PATCH invoices/:invoiceId/void` cancels an unpaid invoice; invoices with pending, verified, or refunded payments cannot be voided
- `POST invoices/:invoiceId/payments`
- `PATCH payments/:paymentId/review` (`VERIFIED` or `REJECTED`)
- `POST invoices/:invoiceId/refunds`

Payments do not affect balances until verified. Verified overpayments are shown as resident credit; refunds are limited to the amount of verified payments not already refunded. Issued invoice lines are immutable; use void-and-reissue when an invoice must be corrected. Submitted proof is captured as a transaction reference and staff notes; uploaded proof files, recurring invoice generation, late fees, and an online payment gateway are not included in the confirmed scope.

Invoice changes use void-and-reissue rather than editing issued financial records. The report period is limited to 366 days; outstanding and overdue are current balances, while payment/refund totals are period-based. CSV export is available to staff with report-export permission.

Original finance-scope verification: Prisma migrations were applied; API and frontend Docker builds passed; backend 66/66 unit tests passed; frontend typecheck and 7/7 API-client tests passed. Live API checks covered invoice/payment/refund lifecycle, period report totals, pending-payment reporting, refund limits, and invoice-void safeguards. Online gateways, late-fee automation, and recurring invoice generation remain excluded from the confirmed starter scope. The student-portal extension adds proof uploads for resident-submitted manual payments.

## Phase 4 (complete for the confirmed starter scope)

The user-confirmed starter scope is:

- Weekly branch mess menus with breakfast, lunch, and dinner entries for each weekday; mess staff can manage menus and residents can view them.
- Complaints submitted by users, visible to the submitter and to authorized staff; staff can claim complaints, set priority, and track OPEN → IN_PROGRESS → RESOLVED → CLOSED.
- Branch notices that staff can draft, edit, publish, unpublish, and schedule with optional visible-from/until dates; residents see currently published notices.

Phase 4 API routes are under `/api/v1/branches/:branchId`:

- `GET/PUT mess-menus` (optionally filter by `weekStart=YYYY-MM-DD`)
- `GET/POST complaints`, `GET complaints/queue`, `POST complaints/:complaintId/assign-to-me`, `PATCH complaints/:complaintId`
- `GET notices`, `GET notices/manage`, `POST notices`, `PATCH notices/:noticeId`

All phase data is tenant- and branch-scoped, uses permission gates, and has tenant RLS policies. The API, additive migration, seed permissions, and shared staff/resident workspace are implemented.

Verification: the migration is applied and Prisma reports the database up to date; all 74 backend tests and 7 frontend tests pass; frontend typecheck and API/frontend Docker builds pass. Live checks exercised weekly menu save/view, notice draft/publish and resident visibility, complaint assignment and status through closure, submitter-only complaint visibility, and denial of resident access to the staff complaint queue. The Phase 4 tabs were inspected in the running workspace.

## Phase 5 (complete for the user-confirmed manual visitor scope)

The gate workflow supports visitor registration with staff approval or rejection, gate check-in/out, and searchable branch visit history. New registration requires visitor name, CNIC, host resident, and purpose; phone remains optional. CNIC is encrypted at rest, fingerprinted for tenant-scoped exact search, and returned only masked. Existing rows created before CNIC was required remain readable. Security can register visits and perform gate check-in/out; Warden can approve or reject pending visits. Every action is branch/tenant scoped, permission-protected, audited without copying visitor identity/contact details, and protected by tenant RLS.

Phase 5 API routes are under `/api/v1/branches/:branchId`:

- `GET/POST visitors` (`GET` accepts a `q` search on visitor name, phone, or CNIC fingerprint)
- `POST visitors/:visitId/approve`, `POST visitors/:visitId/reject`
- `POST visitors/:visitId/check-in`, `POST visitors/:visitId/check-out`

The status sequence is PENDING → APPROVED → CHECKED_IN → CHECKED_OUT, with PENDING → REJECTED as the alternative. Invalid, repeated, or out-of-order transitions are rejected. Biometrics (G-08), visitor charges, visiting hours, and record-retention policy are excluded pending owner decisions (G-21). No automatic visitor-record purge is configured while retention is undecided.

Verification: The original Phase 5 workflow was verified with Security and Warden permissions, tenant/branch-scoped visitor list access, and Resident denial (HTTP 403). The later CNIC extension adds encrypted storage, fingerprint search, and masked responses through an additive migration; see the current session validation results before claiming a live workflow test.

## Platform administrator

The cross-tenant Super Admin uses a separate platform identity and authorization boundary from the tenant-scoped `System Admin` role. Bootstrap the first account with `npm run db:platform-admin:bootstrap` from `backend`; the command requires `DATABASE_MIGRATION_URL` and `FIELD_ENCRYPTION_KEY`. MFA enrollment during bootstrap is optional, but it remains mandatory before the account can access the dashboard: if deferred, the first password login starts a short-lived authenticator enrollment flow and grants no dashboard token until the current code is verified. Recovery codes are issued once after enrollment.

Open `/platform-admin/login` to sign in with the platform email, password, and authenticator or recovery code. If MFA setup was deferred, the same page requires authenticator enrollment before allowing sign-in. The `/system-admin` workspace provides organization metrics, organization create/search/update/suspend/reactivate, tenant user status and role management, and the platform administrator's audit history. Platform sessions use a short-lived access token held in memory; a page reload or expiration requires signing in again. Platform API requests use the platform JWT and never attempt the tenant refresh flow.

Verification for the workspace implementation: frontend/backend production builds and lint passed; all 12 frontend tests and the 4 platform-admin service/MFA tests passed. A live database login and browser workflow were not exercised in this update.

## Student portal (starter scope)

Students with the `Resident` role are sent to `/resident` after signing in. The portal provides a dashboard with outstanding dues and rent/notice notifications; the student's profile and active room/bed allocation; branch-specific invoices, payment history, and payment proof upload/status; complaint submission and tracking; weekly mess menus; and published hostel notices. Students can edit their own first name, last name, phone, and date of birth; future dates are accepted, while invalid calendar dates are rejected. Email/login details, CNIC, status, and room assignment remain staff-managed. Student finance routes scope invoice and proof reads to the authenticated student's linked resident record. Receipts are limited to JPEG, PNG, WebP, or PDF files up to 5 MB, validated by file signature, stored in the database, and downloadable only by the owning student or authorized finance staff. Uploaded payment submissions remain pending until staff verifies or rejects them. Notifications are derived from currently issued invoices and published notices; they are shown in the portal but are not email/SMS push messages.

To link a student login, hostel staff must first create an active user with the `Resident` role, assign the student's branch scope, and use the same email on the resident record; then choose **Link student account** in the resident list. The API only links an active student account in the same tenant with an exact email match, prevents linking one login to multiple resident records, and audits the link. A database migration adds the tenant-bound one-to-one relationship. The seed includes a linked demo resident (`resident@sunrise-hostel.demo` / `Demo1234!`).

Student profile-edit validation: all 12 resident service tests and both student portal component tests pass; backend/frontend typechecks and lint pass. The deployed API and frontend are healthy.

## Phase 6 (incomplete — implementation gaps)

The offline experience caches only aggregate branch counts (active residents, occupied/available beds, pending admissions, open complaints, and pending visitor count) in session storage partitioned by user and branch. It does not cache personal details, visitor contact details, or financial amounts. Cached data remains read-only; writes are blocked and never queued. Cache is available only within the authenticated browser session and current tab.

The backup endpoint performs a non-destructive API-runtime configuration preflight. It does not create a backup or restore one. A separate Phase 7 smoke test round-trips synthetic PostgreSQL data in a disposable container; it does not validate HMS application backups, SeaweedFS recovery, or the RPO/RTO targets. Automated retention cleanup remains deferred until an owner-approved policy is provided.

## Phase 7 (hardening readiness — complete for the agreed local scope)

The API has a configurable global request budget (10,000 requests per minute per API instance by default, aligned to the 100-rps system baseline) and route-specific throttles for authentication endpoints. It trusts the single configured nginx proxy hop so client IP-based limits are not shared across all users behind the proxy. Backend and frontend lint configurations run in CI, including syntax checks for the Phase 7 scripts.

Local verification passed: 3,000/3,000 authenticated localhost requests returned HTTP 200 at 99.98 achieved RPS with 60.65 ms p95; a disposable synthetic PostgreSQL dump/restore smoke test passed; and browser offline simulation retained only aggregate cached counts, hid non-dashboard tabs, blocked sync, and suppressed transient fetch errors. Backend and frontend tests, lint, typecheck, and Docker builds also passed. These results complete the agreed local hardening-readiness scope, not production certification: no actual HMS application backup was restored, no production-like 300-CCU test or RPO/RTO certification was performed, and no live pilot or production deployment is included. Backup preflight reports only API-runtime configuration and explicitly does not assess or execute the host Docker Compose workflow. Retention cleanup remains deferred pending owner policy.
