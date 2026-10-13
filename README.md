# Wholesale General Store — Management, Inventory & Profit Intelligence

A multi-tenant web app for wholesale general stores: catalog, inventory, purchases,
sales, hawker receivables, supplier payables, payments, returns, daily closing,
expenses, OCR bill scanning, and financial reporting. Built with **Next.js 16
(App Router, React 19)** and **Supabase (Postgres + Auth + RLS)**.

All multi-table financial operations run inside `security definer` Postgres RPCs
that re-check permissions server-side; RLS is the second layer. The browser never
writes to financial tables directly.

---

## Feature overview

| Area | What it does |
| --- | --- |
| **Auth & tenancy** | Supabase email/password auth, multiple businesses per user, cookie-selected active business, `owner` / `manager` / `staff` roles with a granular permission model. |
| **Catalog** | Products with base / purchase / sell units, unit-conversion factors, min-stock thresholds, categories, OCR aliases. |
| **Inventory** | Weighted-average costing, immutable stock movements, manual adjustments, and full stock counts (draft → confirm applies variance). |
| **Purchases** | Purchase bills with freight/other costs, multi-payment, supplier ledger (payables), purchase returns. |
| **Sales** | Sales bills for hawkers, per-line units/discount/tax, multi-receipt, hawker ledger (receivables), sales returns, and void (reverses stock + ledger). |
| **Payments** | Customer and supplier payments with optional per-bill allocation; ledger-only credit. |
| **Closing** | Daily cash closing with expected vs counted cash and variance. |
| **Expenses** | Operating expenses, owner drawings, loan principal/interest, capital, tax. |
| **Reports** | Month-to-date sales / gross profit / purchases / expenses, net estimate, and a 6-month trend chart (recharts). |
| **Dashboard** | Today's sales & profit, ledger-based receivables/payables, low-stock list, recent sales. |
| **OCR scanner** | Photograph a paper bill, OCR (Bengali + English), fuzzy-match lines to products, review, then post a sales or purchase bill. |
| **Settings** | Rename business, switch locale, invite members. |
| **Auditability** | Every financial RPC writes an audit-log row. |

---

## Tech stack

- **Next.js 16** (App Router, Server Components, Server Actions) · React 19 · TypeScript 5.9
- **Supabase**: Postgres, Auth, Row Level Security, `@supabase/ssr`
- **Tailwind CSS v4** (CSS-first theme in `src/app/globals.css`)
- **recharts** for charts, **lucide-react** for icons
- **tesseract.js** for local OCR (`ben` + `eng`)
- **Vitest** + **PGlite** for the integration test suite

---

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in the values from your Supabase
project (**Settings → API**):

```bash
cp .env.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon / publishable key>
APPLICATION_BASE_URL=http://localhost:3000
OCR_PROVIDER=tesseract
```

> `SUPABASE_SERVICE_ROLE_KEY` is optional and server-only. Never expose it or
> commit any real key. `.env*.local` is gitignored.

### 3. Apply database migrations

Migrations live in `supabase/migrations/` and are numbered `001`–`020`. Apply them
to your project either with the Supabase CLI or the included helper script.

**Supabase CLI (recommended):**

```bash
supabase link --project-ref <project-ref>
supabase db push
```

**Direct helper script (no CLI needed):**

```bash
# Uses the direct/pooler Postgres connection. Requires the DB password.
$env:SUPABASE_DB_PASSWORD='<db-password>'   # PowerShell
node scripts/migrate-remote.mjs
```

The helper re-runs every migration file; `already exists` errors for migrations
that were previously applied are expected and harmless. Verify what landed with:

```bash
node scripts/verify-remote.mjs
```

### 4. Run

```bash
npm run dev      # http://localhost:3000
```

Sign up, then create your first business from the onboarding screen.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | Public anon/publishable key (RLS applies). |
| `APPLICATION_BASE_URL` | — | Public origin for auth redirects. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only privileged key (scripts/backfills). Never ship to the client. |
| `OCR_PROVIDER` | — | `tesseract` (default) · `http` · `none`. |
| `OCR_HTTP_ENDPOINT` / `OCR_HTTP_API_KEY` | — | Remote OCR endpoint when `OCR_PROVIDER=http`. |
| `AI_PROVIDER_API_KEY` / `AI_PROVIDER_BASE_URL` | — | Optional assistant for alias/extraction post-processing. |

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint (Next.js config). |
| `npm test` | Run all Vitest suites. |
| `npm run test:db` | Integration tests only (`tests/integration`). |
| `npm run verify` | typecheck → lint → test → build (the full gate). |

### Utility scripts (`scripts/`)

| Script | Description |
| --- | --- |
| `migrate-remote.mjs` | Apply `supabase/migrations/*.sql` to a remote DB (`SUPABASE_DB_PASSWORD`). |
| `verify-remote.mjs` | Print table/function/policy counts from the remote DB. |
| `get-keys.mjs` | Attempt to read project keys from the DB (usually unavailable; use the dashboard). |

---

## Data model & accounting rules

### Costing
Inventory uses **weighted-average cost**. `inventory_balances.avg_cost` and
`qty` are updated exclusively through `apply_stock_movement(...)` inside RPCs.

### Ledgers
`hawker_transactions` and `supplier_transactions` are append-only running
ledgers (balance = `debit − credit`). `recalc_hawker_ledger` /
`recalc_supplier_ledger` recompute `balance_after` after out-of-order changes
(e.g. a void). Current balances come from the latest `balance_after` per partner
(`total_receivables` / `total_payables`).

- **Receivable** = positive hawker balance (they owe us).
- **Payable** = positive supplier balance (we owe them).

### Posted bills are immutable
Voids and returns are **separate documents**; they never mutate a posted bill.

- **Void** (`void_sales_bill` / `void_purchase_bill`): reverses inventory and the
  ledger, detaches payment allocations, does not move cash, and is idempotent.
- **Returns** (`post_sales_return` / `post_purchase_return`): re-enter/remove
  stock and, in `credit` mode, adjust the partner ledger; in `cash` mode they
  move cash and post no ledger entry.

### Idempotency
Financial RPCs accept an `idempotency_key`; a unique partial index per table
blocks duplicate posts.

---

## Permissions

```
dashboard.view  reports.view   products.write   inventory.write  suppliers.write
purchases.post  hawkers.write  sales.post       payments.post    expenses.post
scanner.use     closing.post   analytics.view   alerts.manage    audit.view
settings.manage users.manage
```

| Role | Grants |
| --- | --- |
| `owner` | All permissions. |
| `manager` | All except `settings.manage`, `users.manage`. |
| `staff` | Only the explicit `member_permissions` set. |

`app_assert_can(business_id, permission)` raises `NOT_AUTHENTICATED` or
`FORBIDDEN: permission <x> required`. Permissions are computed by
`permissionsFor(role, memberPermissions)` in `src/lib/permissions.ts`.

---

## Project structure

```
src/
  app/
    (app)/                 authenticated area
      dashboard/  products/  inventory/  hawkers/  suppliers/
      purchases/  sales/     payments/   returns (…/return)  closing/
      expenses/   reports/   scanner/    settings/
    api/ocr/               OCR route handler (tesseract.js)
    login/  signup/  onboarding/  auth/callback/
  components/
    app/    shell, nav, status badges
    bills/  bill form, void button
    forms/  payment, return, inventory, settings, … forms
    scanner/ scan-uploader (OCR review → bill)
    charts/ trend-chart (recharts)
    ui/     button, card, table, badge, misc primitives
  lib/
    supabase/   browser + server clients
    data/       read models (lists, options, dashboard, reports)
    auth.ts     session + permission resolution
    permissions.ts  database.types.ts  format.ts  cn.ts
supabase/migrations/   001–020 SQL migrations (schema, RPCs, RLS, seed)
tests/
  db/harness.ts        PGlite shim (auth.users, fixtures)
  integration/*.test.ts migrations, tenancy, sales, purchases, money, returns, rls, admin
scripts/               migrate-remote, verify-remote, get-keys
```

---

## Testing

Integration tests run the real SQL migrations against an in-process
**PGlite** database, so they exercise the RPCs, RLS and constraints exactly as
Postgres would.

```bash
npm test           # all suites
npm run test:db    # integration only
```

Coverage includes migrations/schema, tenancy & permissions, sales, purchases,
money (payments/expenses/closing), returns, RLS write policies, and the admin
RPCs (`update_business`, `invite_member`, stock counts).

---

## OCR bill scanning

`/scanner` uploads an image to `POST /api/ocr`. The route runs Tesseract
(`ben+eng`) locally by default (or a configured HTTP endpoint) and returns raw
text plus parsed lines. The client fuzzy-matches each line to a product, lets you
correct matches/units/quantities/prices, then posts a sales or purchase bill via
the same RPCs used by the manual forms.

Set `OCR_PROVIDER=none` to disable and use manual entry only.

---

## Deployment

1. Deploy to a Next.js host (e.g. Vercel).
2. Set the environment variables above in the hosting dashboard
   (`APPLICATION_BASE_URL` = your public URL).
3. Ensure migrations are applied to the production Supabase project
   (`supabase db push` or `scripts/migrate-remote.mjs`).
4. Add the deployed origin to Supabase Auth **Redirect URLs**.

---

## Security notes

- Financial writes go through `security definer` RPCs that re-check permissions;
  RLS on every tenant table is the second line of defence.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Rotate the database password if it has been shared; it is never needed at
  runtime by the app (only by migrations).
