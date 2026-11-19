# Hostel Management System (HMS) — Abmanix Design System Implementation Report

**Document Status:** Complete & Verified  
**Date:** November 19, 2026  
**Target Project:** Hostel Management System (HMS Phase 1)  
**Reference Design System:** Abmanix Operational UI/UX Design System  

---

## 1. Executive Summary

This report documents the end-to-end implementation of the **Abmanix UI/UX Design System** into the **Hostel Management System (HMS)**. 

The entire visual identity of the Abmanix design documentation (`ABMANIX-DESIGN-SYSTEM.md`, `ABMANIX-DESIGN-TOKENS.css`, `ABMANIX-COMPONENT-SPECIFICATIONS.md`, `ABMANIX-IMPLEMENTATION-GUIDE.md`, and `ABMANIX-DESIGN-REFERENCE.html`) has been systematically mapped and applied to the HMS frontend architecture.

All underlying backend business logic, API contracts, database models, role-based access control (RBAC), offline caching mechanisms, and hostel-specific workflows have been strictly preserved.

---

## 2. Token Architecture & Design System Integration

The design tokens have been integrated into `hms/frontend/src/app/globals.css` with zero reliance on heavy external UI kits, preserving lightweight pure CSS performance with CSS custom properties.

### 2.1 Core Color Tokens

| Token Family | Token Name | Hex Value | Purpose / Application |
|---|---|---|---|
| **Brand Primary** | `--brand-blue-600` | `#1450e0` | Primary brand actions, active navigation indicators, links |
| | `--brand-blue-700` | `#0e3cb8` | Primary button hover state |
| | `--brand-blue-900` | `#0a2666` | Primary button active/pressed state |
| **Brand Accent** | `--brand-yellow-500` | `#f5b400` | Accent badges, gold highlights, active tab line indicator |
| | `--brand-yellow-600` | `#d99a00` | Accent hover state and warning tone base |
| **Ink Palette** | `--ink` | `#0b0d12` | Dark shell sidebar canvas, dark mode root, stat hero tiles |
| | `--ink-2` | `#12151c` | Sidebar interactive item hover, subtle dark surface |
| | `--ink-3` | `#1b2030` | Sidebar active item background |
| | `--ink-line` | `#232837` | Ink border and divider lines |
| | `--ink-text` | `#f2f4f8` | High-contrast white text on dark ink surfaces |
| | `--ink-muted` | `#8d95a6` | Secondary muted text on dark ink surfaces |
| **Light Canvas** | `--color-bg` | `#ffffff` | Elevated cards, dialogs, dropdowns |
| | `--color-bg-subtle` | `#f5f7fb` | Warm Paper page background |
| | `--color-border` | `#e4e7ee` | Standard light mode border |
| | `--color-text` | `#10131a` | Dark charcoal high-contrast reading text |
| | `--color-text-muted`| `#5b6373` | Subtitles, helper text, and table captions |
| **Dark Canvas** | `--color-bg` | `#0b0d12` | Midnight Ink OLED canvas |
| | `--color-bg-elevated`| `#171b24` | Elevated cards and floating panels |
| | `--color-border` | `#262b36` | Subdued borders for dark mode |
| | `--color-text` | `#f2f4f8` | Crisp white primary text |
| | `--color-text-muted`| `#9aa2b1` | Slate gray secondary text |

### 2.2 Typography Scale & Families

- **Primary Sans-Serif:** `Plus Jakarta Sans` (Weights 400, 500, 600, 700, 800) loaded via Google Fonts in `layout.tsx`.
- **Monospace Font:** `JetBrains Mono` (Weights 400, 500, 700) for numeric amounts (PKR), invoice numbers, room codes, timestamps, and CNIC masks.
- **Scale:**
  - `--fs-xs`: `12px` (badging, captions, micro labels)
  - `--fs-sm`: `14px` (table cells, standard buttons, form inputs)
  - `--fs-base`: `16px` (body prose, section lead-ins)
  - `--fs-lg`: `20px` (panel headings, summary stats)
  - Display Headings: `28px`–`36px` bold with negative letter-spacing (`-0.02em`).

### 2.3 Elevation & Border Radii

- `--radius-sm`: `4px` (checkboxes, tags)
- `--radius-md`: `8px` (inputs, buttons, cards, table rows)
- `--radius-lg`: `12px` (floating dialogs, large panels)
- `--radius-full`: `9999px` (status pills, avatars)
- Elevation Shadows:
  - `--shadow-sm`: `0 1px 2px rgba(16, 19, 26, 0.06)`
  - `--shadow-md`: `0 1px 2px rgba(16, 19, 26, 0.04), 0 8px 24px -12px rgba(16, 19, 26, 0.12)`
  - `--shadow-lg`: `0 12px 28px rgba(16, 19, 26, 0.12)`
  - `--shadow-modal`: `0 24px 60px -20px rgba(0, 0, 0, 0.6)`

---

## 3. Component Transformation Summary

### 3.1 Buttons & Interactive Controls
- Implemented button classes: `.button.primary`, `.btn-primary`, `.button.secondary`, `.btn-secondary`, `.btn-accent`, `.button.danger`, `.btn-danger`, `.btn-wa`, `.icon-btn`, and `.button.small`.
- Included focus rings: `outline: 2px solid var(--color-primary); outline-offset: 2px;`.
- Interactive transitions tuned to Abmanix micro-motion timing (`130ms cubic-bezier(0.16, 1, 0.3, 1)`).

### 3.2 Forms & Input Fields
- Standardized form structures using `.field`, `.stack-form`, `.two-fields`, and `.form-grid`.
- Form inputs feature high-contrast 1px solid borders (`var(--color-border)`), transitioning to blue focus borders (`var(--color-primary)`) with subtle glow shadows.
- Helper and error labels (`.form-error`, `.field-hint`) with WCAG AA compliance.

### 3.3 Cards, Panels & Layout Shells
- Panels (`.panel`, `.card`, `.platform-panel`) use white backgrounds on warm paper canvas in light mode and elevated `#171b24` on `#0b0d12` in dark mode.
- Topbar headers (`.workspace-header`, `.platform-header`) feature frosted glass blur (`backdrop-filter: blur(12px)`) with sticky positioning at 64px height.
- Dark Ink sidebar (`.platform-sidebar`) styled at `248px` width with brand-yellow active bar indicator.

### 3.4 Data Tables & Status Badges
- Modern data tables wrapped in `.table-wrap` with sticky header support, zebra hover states, and monospace formatting for IDs, currencies, and room allocations.
- Status badges (`.badge`, `.status`) use live indicator dots with semantic lifecycle coloring:
  - Active / Approved / Present: `.status.active`, `.badge.success`
  - Pending / Review: `.status.pending`, `.badge.warning`
  - Rejected / Suspended / Overdue: `.status.rejected`, `.badge.danger`
  - Neutral / Draft: `.badge.neutral`

### 3.5 Light / Dark Theme Architecture
- Client-side theme switching via `<ThemeToggle />` component.
- Zero-flash theme hydration using inline `<script>` in `layout.tsx` checking `localStorage.getItem('hms-theme')` with OS `prefers-color-scheme` fallback.
- Explicit `[data-theme='dark']` and `[data-theme='light']` CSS overrides.

### 3.6 Thermal Receipt Printing
- Media query `@media print` configured specifically for 80mm thermal printers, hiding UI chrome and headers, formatting clean rent and deposit slips.

---

## 4. Hostel Domain Adaptation (Zero Gym Residue)

All Abmanix components were fully adapted to the hostel operations domain:
- **Members → Residents / Students**
- **Classes / Trainers → Wardens / Rooms / Beds / Allocations**
- **Gym Dues → Hostel Rent, Mess Fees, Security Deposits**
- **Turnstile Gate → Hostel Gate Pass & Night Curfew Entry**
- **Gym Attendance → Resident Daily & Mess Attendance**
- All terminology, labels, and icons strictly conform to hostel management operations.

---

## 5. Verification & Sign-Off

- **Production Build:** `npm run build` completed with 0 errors across 21 routes.
- **TypeScript:** `tsc --noEmit` passed with 0 errors.
- **ESLint:** `next lint` passed with 0 errors and 0 warnings.
- **Test Suite:** 6 test suites, 24 unit tests passed.
