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

The source-only archive is at `../HMS_Phase1.zip`. It excludes environment secrets, dependencies, and generated build output.

---

<div align="center">

**HMS** &nbsp;·&nbsp; Private &nbsp;·&nbsp; Multi-tenant &nbsp;·&nbsp; Pakistan (PKR / Asia/Karachi)

</div>
