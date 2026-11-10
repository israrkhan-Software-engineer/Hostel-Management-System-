# HMS — Hostel Management System

> Multi-tenant SaaS platform for hostel operations — residents, billing, gate, mess, complaints, and reporting.

[![Backend Tests](https://img.shields.io/badge/Backend%20Tests-154%20passed-22c55e?style=flat-square&logo=jest&logoColor=white)](/)
[![Frontend Tests](https://img.shields.io/badge/Frontend%20Tests-23%20passed-22c55e?style=flat-square&logo=jest&logoColor=white)](/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](/)
[![Prisma](https://img.shields.io/badge/Prisma-schema%20valid-0c344b?style=flat-square&logo=prisma&logoColor=white)](/)
[![Build](https://img.shields.io/badge/Build-passing-22c55e?style=flat-square&logo=github-actions&logoColor=white)](/)
[![Lint](https://img.shields.io/badge/Lint-clean-22c55e?style=flat-square&logo=eslint&logoColor=white)](/)
[![Migrations](https://img.shields.io/badge/Migrations-applied-22c55e?style=flat-square&logo=postgresql&logoColor=white)](/)
[![License](https://img.shields.io/badge/License-Private-6b7280?style=flat-square)](/)
**Phase 0 — Foundation & Environment (complete)**
**Phase 1 — Auth, RBAC & scope resolution (complete)**
**Phase 2 — Core domain (complete):** inventory, residents, admissions, attendance, leave, student gate passes, meal attendance/subscriptions, secure student documents, room transfers, Excel exports, and public hostel pages.
**Phase 3 — Finance and notifications:** configurable fee structures, student assignments/discounts, late-fee processing, security-deposit ledger, in-app notifications, and queued email/SMS delivery alongside existing invoicing and payment workflows.
**Phase 4 — Mess, Complaints, and Notices (complete for the confirmed starter scope):** weekly menus, complaint tracking, and branch-wide notices.
**Phase 5 — Gate Operations:** visitor registration, staff approval, gate check-in/out, and visit history. New registrations require Pakistani CNIC; CNIC is encrypted at rest and returned/searchable only in masked/fingerprint form. Existing records remain readable without a CNIC.
**Phase 6 — Offline sync & backup verification (partially complete):** aggregate dashboard counts are cached in the active browser session. Student complaint submissions can queue in session storage and replay online with an idempotency key; staff operations remain blocked offline. Personal details and financial amounts are not included in the dashboard cache. A synthetic PostgreSQL restore smoke exists, but application backup/restore is not verified.
**Phase 7 — Hardening readiness (complete for the agreed local scope):** global API throttling, CI checks, offline browser verification, local 100-rps benchmark, and isolated synthetic PostgreSQL restore smoke test are complete. Production-like certification and an application-data restore remain unverified; no production deployment or owner-policy changes.
**Phase 8 — Pilot (not started):** production-like rollout and operational acceptance remain separate from local hardening.

Phase 2 uses staff-created admissions that require approval before a bed can be assigned. Pending admissions may be edited or cancelled; later states cannot. Inventory records can be edited and soft-archived only when their dependencies are clear (and beds must be available). CNIC values are encrypted at rest and only returned masked. Student attendance, leave requests, gate passes, meal records, subscriptions, and documents are restricted to the authenticated resident where applicable; uploaded documents are encrypted at rest with AES-GCM and served only through permission-checked downloads. Visitor registration remains a separate workflow. Bulk import and maintenance requests/expenses are excluded; bulk import requires formal CRF approval.

Current local verification (2026-11-02): backend 20 suites / 154 tests and frontend 6 suites / 23 tests pass; both typechecks, linters, Prisma schema validation, and production builds pass. All migrations applied successfully to a fresh disposable `hms_test` database; both PostgreSQL integration suites passed (15/15 tests), and the isolated synthetic database restore smoke passed. The new complaint-idempotency/archive migration remains unapplied to any persistent HMS database. No live/production database, authenticated browser account, hosted CI, or production environment was accessed. The source-only project archive is `../HMS_Phase1.zip`; it excludes environment secrets, dependencies, and generated build output.

---

## Table of Contents

- [Overview](#overview)
- [Project Status](#project-status)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Running Tests](#running-tests)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Key Decisions](#key-decisions)
- [Open Decisions](#open-decisions)

---

## Overview

HMS is a multi-tenant SaaS platform designed for hostel operators. Each tenant (hostel organization) is fully isolated via Row-Level Security. The platform supports multiple branches per tenant and covers the full resident lifecycle — from admission and bed allocation through billing, complaints, gate management, and notices.

---

## Project Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 0** | Foundation & Environment | Complete |
| **Phase 1** | Auth, RBAC & Scope Resolution | Complete |
| **Phase 2** | Core Domain — Inventory, Residents, Admissions, Bed Allocation, Check-in/out | Complete |
| **Phase 3** | Finance — Invoices, Payments, Refunds, PDF Downloads | Complete |
| **Phase 4** | Mess, Complaints & Notices | Complete |
| **Phase 5** | Gate Operations — Visitor Registration, Approval, Check-in/out | Complete |
| **Phase 6** | Offline Sync & Backup Verification | Partial |
| **Phase 7** | Hardening Readiness — Throttling, CI, Benchmarks, Smoke Tests | Complete (local scope) |
| **Phase 8** | Pilot — Production Rollout & Operational Acceptance | Not Started |

> **Phase 7 note:** Local hardening is verified (100 rps, synthetic DB restore smoke, offline simulation). Production-like certification, 300-CCU test, and RPO/RTO validation remain out of scope until Phase 8.

---

## Verification Summary (2026-11-02)

| Check | Result |
|-------|--------|
| Backend unit tests | 154 / 154 passed |
| Frontend unit tests | 23 / 23 passed |
| PostgreSQL integration tests | 15 / 15 passed |
| Backend typecheck | Pass |
| Frontend typecheck | Pass |
| Backend lint | Clean |
| Frontend lint | Clean |
| Prisma schema validation | Valid |
| Production build — backend | Pass |
| Production build — frontend | Pass |
| Fresh DB migration | Applied |
| DB restore smoke (synthetic) | Pass |
| Throttle benchmark | 3,000 req @ ~100 rps, p95 60.65 ms |
| Offline simulation | Cached counts only, tabs hidden, fetch errors suppressed |

---

## Tech Stack

> Stack is proposed — pending owner sign-off on **G-02 / OD-13**.

| Layer | Technology |
|-------|------------|
| Frontend / PWA | Next.js 14 (App Router) + React + TypeScript |
| Backend API | NestJS + TypeScript |
| Database | PostgreSQL 16 + Prisma ORM + RLS |
| Cache / Queue | Redis 7 + BullMQ |
| Object Storage | SeaweedFS (S3-compatible, local dev) |
| Reverse Proxy | nginx |
| CI | GitHub Actions |

---

## Quick Start

```bash
# 1. Copy and configure environment secrets
cp .env.example .env

# 2. Start the full local stack (HTTP reverse proxy on :8080)
docker compose up --build -d

# 3. App is served through nginx — migrations run automatically
open http://localhost:8080

# 4. (Optional) Seed demo tenants and staff accounts — development only
docker compose exec api npm run db:seed
```

> The local Compose stack uses SeaweedFS and an HTTP-only localhost nginx proxy. **Never use this configuration in production.**

After seeding, sign in with:

| Field | Value |
|-------|-------|
| Email | `owner@sunrise-hostel.demo` |
| Password | `Demo1234!` |
| Tenant slug | `sunrise-hostel` |

A linked demo resident is also available: `resident@sunrise-hostel.demo` / `Demo1234!`
The local Compose stack uses SeaweedFS as its S3-compatible development object store and an HTTP-only, localhost-bound nginx proxy. Do not use the development environment or proxy configuration in production.
The seed command creates development-only users with simple passwords; never run it against production data.
After seeding, sign in locally with `owner@sunrise-hostel.demo`, password `Demo1234!`, and tenant slug `sunrise-hostel`. These credentials are for local development only.
The seed is safe to rerun: it adds missing demo records and does not clear existing data. It creates demo tenants `sunrise-hostel` and `greenview-hostel`, staff logins (`sysadmin`, `owner`, `warden`, `reception`, `accountant`, `security`, `mess`, and `maintenance` at `@sunrise-hostel.demo` or `@greenview-hostel.demo`), and student logins `resident`, `ayesha.khan`, `bilal.ahmed`, `sana.ali`, `omar.raza`, and `hira.malik` at the same domain. All use `Demo1234!`.

The demo data includes physical inventory, resident/admission and bed-allocation states, invoices with outstanding/overdue balances, pending/verified/rejected payments, a refund, complaints in multiple statuses, draft/published notices, a weekly meal plan, and visitor requests in multiple gate-workflow statuses. It uses synthetic names and does not create CNIC values or platform-admin credentials. Email links to the app use tenant slug `sunrise-hostel` or `greenview-hostel`; seed data is placed in each tenant's main branch.

### Authentication security

Tenant accounts can optionally enable authenticator MFA from **Account security** in the hostel workspace. Save the one-time recovery codes when enrollment completes; login accepts an authenticator or unused recovery code. Set `TENANT_MFA_ENABLED=false` to disable new enrollments without bypassing MFA for accounts that already enabled it. Failed login attempts are locked per account according to `AUTH_LOGIN_MAX_ATTEMPTS` and `AUTH_LOGIN_LOCKOUT_MINUTES`, in addition to the IP rate limit.

Passwords are stored as scrypt hashes. Existing PBKDF2 hashes are verified and upgraded to scrypt after a successful login. Apply the new `20261108000000_phase1_auth_security` Prisma migration before deploying the updated API; it adds tenant MFA recovery data, account lockout fields, and permission catalog entries.

## Performance and private payment-proof storage

The API uses a configurable Prisma connection limit per process (`DATABASE_POOL_MAX`, default `10`); size this against the PostgreSQL connection budget and the number of API/worker replicas. The global tenant interceptor keeps ordinary tenant requests inside a transaction-scoped RLS context. Invoice PDF rendering and payment-proof object I/O are excluded from that request transaction; their database reads/writes explicitly open short tenant-scoped transactions. Payment/invoice atomicity, including the invoice-row lock during proof submission, is retained.

Payment proofs are stored in a private S3-compatible bucket and streamed through permission-checked API routes; objects are not made public. Keep the bucket private and use HTTPS in production. Configure `OBJECT_STORAGE_URL`, access/secret keys, `OBJECT_STORAGE_REGION`, and `OBJECT_STORAGE_BUCKET_PRIVATE_PROOFS`. Optional `OBJECT_STORAGE_SSE` accepts `AES256`, `aws:kms`, or `aws:kms:dsse`. `OBJECT_STORAGE_AUTO_CREATE_BUCKET` is enabled only by default in local Compose; production buckets should be provisioned privately in advance.

The additive `20261112000000_payment_proof_object_storage` migration adds object keys and integrity hashes while retaining legacy database bytes. After applying it, deploy the API and run `npm run migrate:payment-proofs` from `backend` with `DATABASE_MIGRATION_URL` set to a migration-only role that can bypass RLS, and with object-storage access configured. The command uploads each existing proof before clearing its database bytes, so it can be safely rerun after interruption. Do not remove the legacy `proof_data` column until the backfill is complete and verified. This migration/backfill has not been applied to any database in this work.

Student and staff portal pages share the `useOnlineStatus` hook. Visitor/gate operations now live under the `visitors` domain module, with compatibility exports for the former Phase 5 import paths; other historical phase-named modules remain until their boundaries can be split without duplicate routes or workflow changes. No tenant-data cache was introduced. The 200+ tenant, 100,000 resident, 300 concurrent user, 100 RPS, p95, RPO, and RTO targets have not been performance-certified.

---

## Running Tests

```bash
# Backend unit tests
cd backend && npm test

# Frontend unit tests
cd frontend && npx jest --config jest.config.js

# Both
cd backend && npm test && cd ../frontend && npx jest --config jest.config.js
```

---

## Architecture

### Tenancy model
- Shared database with `tenant_id NOT NULL` on all tenant-scoped tables
- PostgreSQL Row-Level Security (RLS) enforced — application credentials must **not** have `BYPASSRLS`
- Each tenant has one or more branches; all API routes are branch-scoped

### Auth & RBAC
- JWT-based auth with silent refresh
- Role-based permissions: Owner, Warden, Receptionist, Accountant, Security, Mess Staff, Resident
- Platform-level Super Admin uses a separate identity and auth boundary from tenant roles
- MFA is mandatory for the Super Admin before dashboard access; optional for privileged tenant roles

### Security
- CNIC values encrypted at rest using `FIELD_ENCRYPTION_KEY`; returned only in masked/fingerprint form
- Visitor identity and contact details are excluded from audit logs
- Financial amounts excluded from dashboard cache
- Route-specific throttles on auth endpoints; global 10,000 req/min budget per API instance

### Offline support (Phase 6, partial)
- Dashboard aggregate counts cached in session storage (partitioned by user + branch)
- Student complaint submissions queue in session storage with idempotency keys and replay on reconnect
- All staff operations remain blocked offline

---

## API Reference

All authenticated routes are branch-scoped under `/api/v1/branches/:branchId`.

<details>
<summary><strong>Phase 2 — Inventory, Residents & Admissions</strong></summary>

```
GET  /api/v1/branches                              # Active branches for signed-in staff
GET  /api/v1/auth/profile                          # Current user role + permission codes
GET  /api/v1/public/hostels/:slug                  # Public hostel page (no resident data)

GET|POST     inventory/buildings
PATCH|DELETE inventory/buildings/:buildingId
POST         inventory/floors
PATCH|DELETE inventory/floors/:floorId
GET|POST     inventory/rooms
PATCH|DELETE inventory/rooms/:roomId
GET|POST     inventory/beds
PATCH|DELETE inventory/beds/:bedId

GET|POST          residents
GET|PATCH|DELETE  residents/:residentId

GET|POST   admissions
PATCH      admissions/:admissionId
POST       admissions/:admissionId/cancel
PATCH      admissions/:admissionId/decision
GET        admissions/available-beds
POST       admissions/:admissionId/allocation
POST       admissions/:admissionId/check-in
POST       admissions/:admissionId/check-out
```
</details>

<details>
<summary><strong>Phase 3 — Finance</strong></summary>

```
GET  finance-report?from=YYYY-MM-DD&to=YYYY-MM-DD  # Period report (max 366 days)

GET|POST   invoices
GET        invoices/:invoiceId
GET        invoices/:invoiceId/pdf                  # Scoped PDF; does not create records
PATCH      invoices/:invoiceId/void                 # Unpaid only
POST       invoices/:invoiceId/payments
PATCH      payments/:paymentId/review               # VERIFIED | REJECTED
POST       invoices/:invoiceId/refunds
```

> Monetary values stored as integer minor units. Payments only affect balances after verification. Issued invoice lines are **immutable** — use void-and-reissue to correct.
</details>

<details>
<summary><strong>Phase 4 — Mess, Complaints & Notices</strong></summary>

```
GET|PUT    mess-menus                               # ?weekStart=YYYY-MM-DD
GET|POST   complaints
GET        complaints/queue
POST       complaints/:complaintId/assign-to-me
PATCH|DELETE complaints/:complaintId

GET        notices                                  # Published notices (resident view)
GET        notices/manage                           # All notices (staff view)
POST       notices
PATCH      notices/:noticeId
```
</details>

<details>
<summary><strong>Phase 5 — Gate Operations</strong></summary>

```
GET|POST   visitors                                 # ?q= search on name, phone, CNIC fingerprint
POST       visitors/:visitId/approve
POST       visitors/:visitId/reject
POST       visitors/:visitId/check-in
POST       visitors/:visitId/check-out
DELETE     visitors/:visitId                        # Soft-archive; does not erase identity data
```

> Status flow: `PENDING → APPROVED → CHECKED_IN → CHECKED_OUT` or `PENDING → REJECTED`. Invalid/repeated/out-of-order transitions are rejected.
</details>

---

## Platform Administrator

```bash
# Bootstrap the first Super Admin account
cd backend && npm run db:platform-admin:bootstrap
# Requires: DATABASE_MIGRATION_URL and FIELD_ENCRYPTION_KEY
```

- Login at `/platform-admin/login` (email + password + TOTP or recovery code)
- MFA enrollment is mandatory before dashboard access; if deferred at bootstrap, enrollment is required on first login
- Recovery codes are issued **once** after enrollment
- Platform sessions use short-lived in-memory access tokens; reloading requires re-authentication

---

## Key Decisions

| Decision | Value | Ref |
|----------|-------|-----|
| Database | PostgreSQL 16 | G-02 / OD-13 |
| Tenancy model | Shared DB + `tenant_id` NOT NULL + RLS | G-01 |
| Timezone | Asia/Karachi | G-04 / OD-08 |
| Currency | PKR (minor units) | G-04 / OD-08 |
| Online payments | Manual proof only | G-07 |
| MFA scope | Optional for privileged roles | G-05 / OD-32 |
| Backup retention | Policy-driven — owner must set | G-09 / OD-06 |

---

## Open Decisions

The following require owner confirmation before implementation or production deployment:

- **G-01** — Tenancy model approval
- **G-02 / OD-13** — Stack approval (PostgreSQL + Next.js + NestJS)
- **G-05** — MFA scope for privileged roles
- **G-07 / OD-01** — Online payment gateway
- **G-08** — Biometric gate verification (currently deferred)
- **G-21** — Visitor record retention and auto-purge policy
- **OD-14** — Tenant URL scheme (slug vs subdomain)
- **SAAS-01 to SAAS-05** — Multi-tenancy gap rows

See [`gap.md`](./gap.md) for the full open-decision register.

---

## Project Archive
- `GET/POST inventory/buildings`, `PATCH/DELETE inventory/buildings/:buildingId`
- `POST inventory/floors`, `PATCH/DELETE inventory/floors/:floorId`
- `GET/POST inventory/rooms`, `PATCH/DELETE inventory/rooms/:roomId`
- `GET/POST inventory/beds`, `PATCH/DELETE inventory/beds/:bedId`
- `GET/POST residents`, `GET/PATCH/DELETE residents/:residentId`
- `GET/POST admissions`, `PATCH admissions/:admissionId`, `POST admissions/:admissionId/cancel`, `PATCH admissions/:admissionId/decision`
- `GET admissions/available-beds`, `POST admissions/:admissionId/allocation`
- `POST admissions/:admissionId/check-in` and `POST admissions/:admissionId/check-out`
- `GET/POST attendance`, `GET attendance/report`, and `GET resident/attendance`
- `GET/POST resident/leave-requests`, `GET leave-requests`, and `PATCH leave-requests/:requestId/decision`
- `GET/POST resident/gate-passes`, `GET gate-passes`, `PATCH gate-passes/:passId/decision`, and `POST gate-passes/:passId/return`
- `GET/POST meal-attendance`, `GET resident/meal-attendance`, and meal subscription plan/subscription routes
- Resident-scoped document upload, replacement, listing, and download routes; staff-authorized deletion
- `GET room-transfers`, `GET available-transfer-beds`, and `POST residents/:residentId/room-transfers`
- Excel workbook downloads at `GET exports/residents`, `exports/admissions`, `exports/attendance`, and `exports/finance`
- `GET /api/v1/branches` returns only active branches the signed-in staff member can access
- `GET /api/v1/auth/profile` returns the current user’s role and permission codes
- `GET /api/v1/public/hostels/:slug` returns public hostel and active branch contact details only

The source-only archive is at `../HMS_Phase1.zip`. It excludes environment secrets, dependencies, and generated build output.

---
The staff and resident portals include permission-filtered attendance, leave, gate-pass, meal, subscription, and secure document workflows. Room transfers run transactionally and preserve prior allocation and transfer history. Excel exports are branch-scoped and additionally verify permission to read the selected dataset. Apply the `20261109000000_phase2_hostel_services` migration before deploying these endpoints.

Bed assignment is conditional and transactional; room bed capacity and active bed uniqueness are enforced. The local Docker Compose stack was verified running and accessible through nginx at `http://localhost:8080`; PostgreSQL, Redis, API, and frontend readiness checks pass, and the worker remains running.

<div align="center">

**HMS** &nbsp;·&nbsp; Private &nbsp;·&nbsp; Multi-tenant &nbsp;·&nbsp; Pakistan (PKR / Asia/Karachi)

</div>
The initial finance slice adds tenant- and branch-scoped issued invoices with multiple charge lines, manual payment records requiring staff verification, balance/credit calculations, and manual refund records. Monetary values are stored as integer minor units in the tenant's currency. Accountant demo accounts can view residents for billing, issue invoices, record payments, verify payments, and approve refunds according to their seeded permissions. The user confirmed these starter defaults; the workspace does not contain enough detail to assert that all G-06/G-17 requirements are resolved.

Finance API routes are under `/api/v1/branches/:branchId`:

- `GET finance-report?from=YYYY-MM-DD&to=YYYY-MM-DD` returns period collections, issued totals, pending amounts, outstanding and overdue balances, and up to 100 outstanding invoices; the summary includes all matching invoices
- `GET/POST invoices`, `GET invoices/:invoiceId`
- `GET invoices/:invoiceId/pdf` downloads a tenant- and branch-scoped PDF generated from the existing invoice and payment records; repeated downloads do not create invoices.
- `PATCH invoices/:invoiceId/void` cancels an unpaid invoice; invoices with pending, verified, or refunded payments cannot be voided
- `POST invoices/:invoiceId/payments`
- `PATCH payments/:paymentId/review` (`VERIFIED` or `REJECTED`)
- `POST invoices/:invoiceId/refunds`

Payments do not affect balances until verified. Verified overpayments are shown as resident credit; refunds are limited to the amount of verified payments not already refunded. Issued invoice lines are immutable; use void-and-reissue when an invoice must be corrected. Payment-proof uploads continue to be validated and stored with the existing payment workflow. Online payment gateways remain out of scope.

Invoice changes use void-and-reissue rather than editing issued financial records. The report period is limited to 366 days; outstanding and overdue are current balances, while payment/refund totals are period-based. CSV export is available to staff with report-export permission.

The Phase 3 extension adds:

- Fee structures for monthly, quarterly, and yearly billing, with room/category labels and immutable per-resident assignment history. An assignment can generate one invoice; duplicate generation is rejected.
- Late-fee rules using fixed minor-unit amounts or percentage basis points. A daily BullMQ job processes overdue invoices, adds an auditable invoice line and history record once per rule/invoice, and can also be run by authorized staff.
- Student-specific fixed, percentage, and scholarship discounts. Discounts require authorized approval and apply to fee-generated invoices. Percentage values are entered as basis points by the API (100 basis points = 1%).
- A security-deposit ledger for deposits, signed adjustments, and refunds. Refunds are balance-checked while locking the resident row; unique submission keys prevent replayed transactions.
- In-app notification history, read/unread state, mark-all-read, and per-category channel preferences. Invoice generation, due-date reminders, verified payments, admissions, leave/gate-pass decisions, and published announcements generate events.
- A separate BullMQ worker sends encrypted-at-rest delivery payloads with exponential retries, retained failures, and deterministic job IDs. Email uses Resend; SMS uses Twilio. Reset tokens remain single-use and expire after one hour; reset links are delivered by email and are never returned by the API.

Finance management APIs are also available under `/api/v1/branches/:branchId`: `GET/POST fee-structures`, `PATCH fee-structures/:id/deactivate`, `POST fee-structures/:id/assignments`, `GET residents/:id/fee-history`, `POST fee-assignments/:id/invoices`, `GET/POST late-fee-settings`, `PATCH late-fee-settings/:id/deactivate`, `POST late-fees/apply`, `GET late-fee-history`, `GET/POST discounts`, `PATCH discounts/:id/approve`, `POST security-deposits/transactions`, `GET residents/:id/security-deposit` (finance staff), and `GET resident/security-deposit` (the signed-in resident only). In-app notification routes are `/api/v1/notifications`, `/read-all`, `/:id/read`, and `/preferences`.

Apply `backend/prisma/migrations/20261110000000_phase3_finance_notifications/migration.sql` before deploying these APIs. Configure email with `NOTIFICATION_EMAIL_PROVIDER=resend`, `NOTIFICATION_EMAIL_API_KEY`, and `NOTIFICATION_EMAIL_FROM`; configure SMS with `NOTIFICATION_SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`. `APP_FRONTEND_URL` controls reset-link origin, and `WORKER_CONCURRENCY` sets worker parallelism. Blank providers disable actual delivery; jobs requiring an unconfigured provider will retry and remain visible in the failed queue.

Historical verification before this extension: Prisma migrations were applied; API and frontend Docker builds passed; backend 66/66 unit tests passed; frontend typecheck and 7/7 API-client tests passed. Live API checks covered invoice/payment/refund lifecycle, period report totals, pending-payment reporting, refund limits, and invoice-void safeguards. At that time online gateways, late-fee automation, and recurring invoice generation were excluded from the starter scope. The student-portal extension adds proof uploads for resident-submitted manual payments.

## Phase 4 (complete for the confirmed starter scope)

The user-confirmed starter scope is:

- Weekly branch mess menus with breakfast, lunch, and dinner entries for each weekday; mess staff can manage menus and residents can view them.
- Complaints submitted by users, visible to the submitter and to authorized staff; staff can claim complaints, set priority, and track OPEN → IN_PROGRESS → RESOLVED → CLOSED.
- Branch notices that staff can draft, edit, publish, unpublish, and schedule with optional visible-from/until dates; residents see currently published notices.

Phase 4 API routes are under `/api/v1/branches/:branchId`:

- `GET/PUT mess-menus` (optionally filter by `weekStart=YYYY-MM-DD`)
- `GET/POST complaints`, `GET complaints/queue`, `POST complaints/:complaintId/assign-to-me`, `PATCH complaints/:complaintId`, `DELETE complaints/:complaintId`
- `GET notices`, `GET notices/manage`, `POST notices`, `PATCH notices/:noticeId`

All phase data is tenant- and branch-scoped, uses permission gates, and has tenant RLS policies. Offline complaint submissions include a client mutation ID so a retry after an interrupted response cannot create a duplicate. Resolved or closed complaints may be soft-archived; archived records are hidden from normal lists but retained, with no physical purge while retention is undecided. The API, additive migration, seed permissions, and shared staff/resident workspace are implemented.

Historical Phase 4 verification: the original migration and live role workflows were tested at the time. The new additive migration described in the current local verification remains unapplied.

## Phase 5 (complete for the user-confirmed manual visitor scope)

The gate workflow supports visitor registration with staff approval or rejection, gate check-in/out, and searchable branch visit history. New registration requires visitor name, CNIC, host resident, and purpose; phone remains optional. CNIC is encrypted at rest, fingerprinted for tenant-scoped exact search, and returned only masked. Existing rows created before CNIC was required remain readable. Security can register visits and perform gate check-in/out; Warden can approve or reject pending visits. Every action is branch/tenant scoped, permission-protected, audited without copying visitor identity/contact details, and protected by tenant RLS.

Phase 5 API routes are under `/api/v1/branches/:branchId`:

- `GET/POST visitors` (`GET` accepts a `q` search on visitor name, phone, or CNIC fingerprint)
- `POST visitors/:visitId/approve`, `POST visitors/:visitId/reject`
- `POST visitors/:visitId/check-in`, `POST visitors/:visitId/check-out`
- `DELETE visitors/:visitId` soft-archives rejected or checked-out visits; it does not erase visitor identity data

The status sequence is PENDING → APPROVED → CHECKED_IN → CHECKED_OUT, with PENDING → REJECTED as the alternative. Invalid, repeated, or out-of-order transitions are rejected. Biometrics (G-08) are not approved; visitor hours and record-retention policy (G-21) are deferred by the user. No automatic visitor-record purge is configured while retention is undecided.

Verification: The original Phase 5 workflow was verified with Security and Warden permissions, tenant/branch-scoped visitor list access, and Resident denial (HTTP 403). The later CNIC extension adds encrypted storage, fingerprint search, and masked responses through an additive migration; see the current session validation results before claiming a live workflow test.

## Platform administrator

The cross-tenant Super Admin uses a separate platform identity and authorization boundary from the tenant-scoped `System Admin` role. Bootstrap the first account with `npm run db:platform-admin:bootstrap` from `backend`; the command requires `DATABASE_MIGRATION_URL` and `FIELD_ENCRYPTION_KEY`. MFA enrollment during bootstrap is optional, but it remains mandatory before the account can access the dashboard: if deferred, the first password login starts a short-lived authenticator enrollment flow and grants no dashboard token until the current code is verified. Recovery codes are issued once after enrollment.

Open `/platform-admin/login` to sign in with the platform email, password, and authenticator or recovery code. If MFA setup was deferred, the same page requires authenticator enrollment before allowing sign-in. The `/system-admin` workspace provides organization metrics, organization create/search/update/suspend/reactivate, tenant user status and role management, SaaS plan/trial/subscription management, platform billing, and the platform administrator's audit history. Platform sessions use a short-lived access token held in memory; a page reload or expiration requires signing in again. Platform API requests use the platform JWT and never attempt the tenant refresh flow.

Verification for the workspace implementation: frontend/backend production builds and lint passed; all 12 frontend tests and the 4 platform-admin service/MFA tests passed. A live database login and browser workflow were not exercised in this update.

## Student portal (starter scope)

Students with the `Resident` role are sent to `/resident` after signing in. The portal provides a dashboard with outstanding dues and rent/notice notifications; the student's profile and active room/bed allocation; branch-specific invoices, payment history, and payment proof upload/status; complaint submission and tracking; weekly mess menus; and published hostel notices. Students can edit their own first name, last name, phone, and date of birth; future dates are accepted, while invalid calendar dates are rejected. Email/login details, CNIC, status, and room assignment remain staff-managed. Student finance routes scope invoice and proof reads to the authenticated student's linked resident record. Receipts are limited to JPEG, PNG, WebP, or PDF files up to 5 MB, validated by file signature, stored in private object storage after the Phase 5 migration/backfill, and downloadable only by the owning student or authorized finance staff. Uploaded payment submissions remain pending until staff verifies or rejects them. Notifications are derived from currently issued invoices and published notices; they are shown in the portal but are not email/SMS push messages.

To link a student login, hostel staff must first create an active user with the `Resident` role, assign the student's branch scope, and use the same email on the resident record; then choose **Link student account** in the resident list. The API only links an active student account in the same tenant with an exact email match, prevents linking one login to multiple resident records, and audits the link. A database migration adds the tenant-bound one-to-one relationship. The seed includes a linked demo resident (`resident@sunrise-hostel.demo` / `Demo1234!`).

Student profile-edit validation: all 12 resident service tests and both student portal component tests pass; backend/frontend typechecks and lint pass. The deployed API and frontend are healthy.

## Phase 6 (partially implemented)

The dashboard cache contains only aggregate branch counts (active residents, occupied/available beds, pending admissions, open complaints, and pending visitor count) in session storage partitioned by user and branch; it excludes resident details, visitor contact details, and financial amounts. Separately, the student portal can queue complaint submissions in session storage and sync them online using a server-verified idempotency key. Failed submissions remain visible with an error and can be discarded. All other staff operations are blocked offline. The queue is tab-session scoped, not cross-device or an offline copy of the full application.

The backup endpoint performs a non-destructive API-runtime configuration preflight. It does not create a backup or restore one. A separate Phase 7 smoke test round-trips synthetic PostgreSQL data in a disposable container; it does not validate HMS application backups, SeaweedFS recovery, or the RPO/RTO targets. Automated retention cleanup remains deferred until an owner-approved policy is provided.

## Phase 7 (hardening readiness — complete for the agreed local scope)

The API has a configurable global request budget (10,000 requests per minute per API instance by default, aligned to the 100-rps system baseline) and route-specific throttles for authentication endpoints. It trusts the single configured nginx proxy hop so client IP-based limits are not shared across all users behind the proxy. Backend and frontend lint configurations run in CI, including syntax checks for the Phase 7 scripts.

Local verification passed: 3,000/3,000 authenticated localhost requests returned HTTP 200 at 99.98 achieved RPS with 60.65 ms p95; a disposable synthetic PostgreSQL dump/restore smoke test passed; and browser offline simulation retained only aggregate cached counts, hid non-dashboard tabs, blocked sync, and suppressed transient fetch errors. Backend and frontend tests, lint, typecheck, and Docker builds also passed. These results complete the agreed local hardening-readiness scope, not production certification: no actual HMS application backup was restored, no production-like 300-CCU test or RPO/RTO certification was performed, and no live pilot or production deployment is included. Backup preflight reports only API-runtime configuration and explicitly does not assess or execute the host Docker Compose workflow. Retention cleanup remains deferred pending owner policy.

## Phase 4 — SaaS subscriptions and tenant staff management

The Super Admin workspace manages Basic, Standard, and Premium subscription plans, configurable monthly/yearly prices, feature flags, user/branch limits, default trial duration, tenant plan assignment, suspension/reactivation, subscription history, platform invoices/payments, and subscription reports. Platform billing records are isolated from resident invoices. Initial plan prices are zero and must be configured by a Super Admin before paid billing is used; amounts are stored in integer minor currency units.

New tenants receive the configured trial plan and expiration date. Existing tenants receive a trial record when the migration is deployed. Trial expiry is enforced on tenant API access and by the daily worker job; the worker also sends in-app/email reminders to the tenant Owner within the configured lead time. Set `PLATFORM_WORKER_ADMIN_EMAIL` to the email address of an active Super Admin so the RLS-protected worker can perform these platform maintenance tasks. If unset, reminders and scheduled expiry are disabled; API access still rejects expired trials.

Tenant staff with the necessary `users` and `roles` permissions can create and edit staff accounts, deactivate/reactivate accounts, reset staff passwords, create custom roles, and assign permissions within their own permission ceiling. Account status/password changes revoke active sessions. The hostel workspace also provides authenticated change-password (current password required), which signs the user out. The platform-level branch-creation endpoint enforces the active plan's branch limit; staff account creation/reactivation enforces its active-user limit. Required permission routes are under `/api/v1/tenant-management` and `POST /api/v1/branches`.

Super Admin endpoints are under `/api/v1/platform/admin`: `GET/POST plans`, `PATCH plans/:planId`, `GET/PATCH trial-settings`, `GET/POST tenants/:tenantId/subscription`, `PATCH tenants/:tenantId/subscription/status`, `GET invoices`, `POST invoices/:invoiceId/payments`, and `GET reports/subscriptions`. Tenant endpoints include `GET/POST tenant-management/users`, `PATCH tenant-management/users/:userId`, `POST tenant-management/users/:userId/password`, `GET/POST tenant-management/roles`, `PATCH/DELETE tenant-management/roles/:roleId`, and `POST auth/change-password`.

Apply `backend/prisma/migrations/20261111000000_phase4_saas_management/migration.sql` before deploying this phase. Configure `PLATFORM_WORKER_ADMIN_EMAIL` in the worker environment for scheduled trial expiry and reminders.
