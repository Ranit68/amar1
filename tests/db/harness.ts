import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export type TestDb = PGlite;

/**
 * Boot an in-memory PostgreSQL (PGLite/WASM) with a minimal Supabase `auth`
 * shim, the API roles Supabase would provide, and every migration applied.
 *
 * Identity in tests is driven by the GUC `app.current_user_id`, which the shim
 * `auth.uid()` and `public.app_user_id()` both read.
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();

  await pg.exec(`
    create schema if not exists auth;

    create table if not exists auth.users (
      id                  uuid primary key default gen_random_uuid(),
      email               text unique,
      raw_user_meta_data  jsonb not null default '{}'::jsonb,
      created_at          timestamptz not null default now()
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $fn$
      select nullif(current_setting('app.current_user_id', true), '')::uuid;
    $fn$;
  `);

  await pg.exec(`
    do $do$
    begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'app_client') then
        create role app_client nologin;
      end if;
    end
    $do$;
  `);

  let hasPgcrypto = true;
  try {
    await pg.exec("create extension if not exists pgcrypto;");
  } catch {
    hasPgcrypto = false;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    let sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (!hasPgcrypto) {
      sql = sql.replace(/create extension if not exists pgcrypto;/gi, "");
    }
    try {
      await pg.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed:\n${String(err)}`);
    }
  }

  return pg;
}

export async function setUser(pg: TestDb, userId: string | null): Promise<void> {
  await pg.query("select set_config('app.current_user_id', $1, false)", [userId ?? ""]);
}

export async function createUser(pg: TestDb, email: string): Promise<string> {
  const res = await pg.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return res.rows[0]!.id;
}

export async function createBusinessWithOwner(
  pg: TestDb,
  userId: string,
  name = "Test Store",
): Promise<string> {
  const res = await pg.query<{ id: string }>(
    "insert into public.businesses (name) values ($1) returning id",
    [name],
  );
  const businessId = res.rows[0]!.id;
  await pg.query(
    "insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')",
    [businessId, userId],
  );
  return businessId;
}

export async function createProduct(
  pg: TestDb,
  businessId: string,
  opts: { name: string; sku?: string; baseUnit?: string },
): Promise<string> {
  const res = await pg.query<{ id: string }>(
    `insert into public.products (business_id, name, sku, base_unit)
     values ($1, $2, $3, $4) returning id`,
    [businessId, opts.name, opts.sku ?? opts.name.toLowerCase().replace(/\s+/g, "-"), opts.baseUnit ?? "kg"],
  );
  return res.rows[0]!.id;
}

export async function createSupplier(pg: TestDb, businessId: string, name = "Supplier A"): Promise<string> {
  const res = await pg.query<{ id: string }>(
    "insert into public.suppliers (business_id, name) values ($1, $2) returning id",
    [businessId, name],
  );
  return res.rows[0]!.id;
}

export async function createHawker(pg: TestDb, businessId: string, name = "Hawker A"): Promise<string> {
  const res = await pg.query<{ id: string }>(
    "insert into public.hawkers (business_id, name) values ($1, $2) returning id",
    [businessId, name],
  );
  return res.rows[0]!.id;
}

export async function cashAccountId(pg: TestDb, businessId: string, name = "Cash Drawer"): Promise<string> {
  const res = await pg.query<{ id: string }>(
    "select id from public.cash_accounts where business_id = $1 and name = $2",
    [businessId, name],
  );
  return res.rows[0]!.id;
}

export interface LineInput {
  product_id: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount?: number;
  tax?: number;
  raw_name?: string;
}

export interface PurchaseInput {
  businessId: string;
  supplierId: string;
  items: LineInput[];
  invoiceNumber?: string;
  invoiceDate?: string;
  discountTotal?: number;
  freightCost?: number;
  otherCosts?: number;
  received?: Array<{ amount: number; cash_account_id: string; method?: string }>;
  idempotencyKey?: string;
}

export async function postPurchase(pg: TestDb, input: PurchaseInput): Promise<Record<string, unknown>> {
  const payload = {
    business_id: input.businessId,
    supplier_id: input.supplierId,
    invoice_number: input.invoiceNumber,
    invoice_date: input.invoiceDate,
    discount_total: input.discountTotal ?? 0,
    freight_cost: input.freightCost ?? 0,
    other_costs: input.otherCosts ?? 0,
    payments: input.received ?? [],
    idempotency_key: input.idempotencyKey,
    items: input.items,
  };
  const res = await pg.query<{ r: Record<string, unknown> }>(
    "select public.post_purchase_bill($1::jsonb) as r",
    [JSON.stringify(payload)],
  );
  return res.rows[0]!.r;
}

export interface SaleInput {
  businessId: string;
  hawkerId: string;
  items: LineInput[];
  invoiceNumber?: string;
  invoiceDate?: string;
  discountTotal?: number;
  received?: Array<{ amount: number; cash_account_id: string; method?: string }>;
  idempotencyKey?: string;
  allowCreditOverride?: boolean;
}

export async function postSale(pg: TestDb, input: SaleInput): Promise<Record<string, unknown>> {
  const payload = {
    business_id: input.businessId,
    hawker_id: input.hawkerId,
    invoice_number: input.invoiceNumber,
    invoice_date: input.invoiceDate,
    discount_total: input.discountTotal ?? 0,
    received: input.received ?? [],
    idempotency_key: input.idempotencyKey,
    allow_credit_override: input.allowCreditOverride ?? false,
    items: input.items,
  };
  const res = await pg.query<{ r: Record<string, unknown> }>(
    "select public.post_sales_bill($1::jsonb) as r",
    [JSON.stringify(payload)],
  );
  return res.rows[0]!.r;
}

export async function stockOf(pg: TestDb, businessId: string, productId: string): Promise<{ qty: string; avg: string }> {
  const res = await pg.query<{ qty: string; avg_cost: string }>(
    "select qty::text, avg_cost::text from public.inventory_balances where business_id = $1 and product_id = $2",
    [businessId, productId],
  );
  const row = res.rows[0];
  return { qty: row?.qty ?? "0", avg: row?.avg_cost ?? "0" };
}
