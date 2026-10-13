import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusinessWithOwner, createTestDb, createUser, setUser, type TestDb } from "../db/harness";

let pg: TestDb;
let owner: string;
let business: string;

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "owner@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner);
});

afterAll(async () => {
  await pg.close();
});

describe("migrations", () => {
  it("creates the full schema (tables)", async () => {
    const res = await pg.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(res.rows[0]!.n).toBeGreaterThanOrEqual(34);
  });

  it("creates the core RPCs", async () => {
    const res = await pg.query<{ proname: string }>(
      `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('post_purchase_bill','approve_purchase_bill','void_purchase_bill',
                          'post_sales_bill','approve_sales_bill','void_sales_bill',
                          'post_customer_payment','post_supplier_payment','record_expense',
                          'apply_stock_adjustment','confirm_stock_count','confirm_daily_closing',
                          'apply_stock_movement','resolve_unit_factor')`,
    );
    expect(res.rows.length).toBe(14);
  });

  it("seeds per-business defaults on business creation", async () => {
    const accounts = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.cash_accounts where business_id = $1",
      [business],
    );
    expect(accounts.rows[0]!.n).toBe(3);

    const cats = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.expense_categories where business_id = $1",
      [business],
    );
    expect(cats.rows[0]!.n).toBe(6);

    const units = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.units_catalog where business_id = $1",
      [business],
    );
    expect(units.rows[0]!.n).toBe(8);

    const general = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.categories where business_id = $1 and name = 'General'",
      [business],
    );
    expect(general.rows[0]!.n).toBe(1);
  });

  it("assigns owners the full permission set and blocks unknown users", async () => {
    const res = await pg.query<{ n: number }>(
      "select cardinality(public.app_permissions($1))::int as n",
      [business],
    );
    expect(res.rows[0]!.n).toBe(17); // 17 permission keys in the owner set

    const stranger = await createUser(pg, "stranger@example.com");
    await setUser(pg, stranger);
    const perms = await pg.query<{ n: number }>(
      "select cardinality(public.app_permissions($1))::int as n",
      [business],
    );
    expect(perms.rows[0]!.n).toBe(0);
    await setUser(pg, owner);
  });

  it("resolves unit conversions including Bengali aliases", async () => {
    const pieceProduct = await pg.query<{ id: string }>(
      `insert into public.products (business_id, name, sku, base_unit)
       values ($1, 'Soap', 'soap', 'piece') returning id`,
      [business],
    );
    const massProduct = await pg.query<{ id: string }>(
      `insert into public.products (business_id, name, sku, base_unit)
       values ($1, 'Sugar', 'sugar', 'g') returning id`,
      [business],
    );

    const dozen = await pg.query<{ f: string }>(
      "select public.resolve_unit_factor($1, 'dozen')::text as f",
      [pieceProduct.rows[0]!.id],
    );
    expect(Number(dozen.rows[0]!.f)).toBe(12);

    const keg = await pg.query<{ f: string }>(
      "select public.resolve_unit_factor($1, 'কেজি')::text as f",
      [massProduct.rows[0]!.id],
    );
    expect(Number(keg.rows[0]!.f)).toBe(1000);

    await expect(
      pg.query("select public.resolve_unit_factor($1, 'dozen')", [massProduct.rows[0]!.id]),
    ).rejects.toThrow(/INCOMPATIBLE_UNIT/);

    await expect(
      pg.query("select public.resolve_unit_factor($1, 'carton')", [pieceProduct.rows[0]!.id]),
    ).rejects.toThrow(/UNKNOWN_UNIT_CONVERSION/);
  });

  it("rejects unauthenticated RPC calls", async () => {
    await setUser(pg, null);
    await expect(
      pg.query("select public.post_purchase_bill($1::jsonb)", [JSON.stringify({ business_id: business })]),
    ).rejects.toThrow(/NOT_AUTHENTICATED/);
    await setUser(pg, owner);
  });
});
