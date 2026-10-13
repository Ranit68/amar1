import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cashAccountId,
  createBusinessWithOwner,
  createHawker,
  createProduct,
  createSupplier,
  createTestDb,
  createUser,
  postPurchase,
  postSale,
  setUser,
  stockOf,
  type TestDb,
} from "../db/harness";

let pg: TestDb;
let owner: string;
let business: string;
let supplier: string;
let hawker: string;
let cash: string;
let product: string;

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "returns-owner@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner, "Returns Co");
  supplier = await createSupplier(pg, business);
  hawker = await createHawker(pg, business);
  cash = await cashAccountId(pg, business);
  product = await createProduct(pg, business, { name: "Return Rice", baseUnit: "kg" });

  await postPurchase(pg, {
    businessId: business,
    supplierId: supplier,
    items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 100 }],
  });
  await postSale(pg, {
    businessId: business,
    hawkerId: hawker,
    items: [{ product_id: product, qty: 4, unit: "kg", unit_price: 200 }],
  });
});

afterAll(async () => {
  await pg.close();
});

async function postReturn(fn: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await pg.query<{ r: Record<string, unknown> }>(
    `select public.${fn}($1::jsonb) as r`,
    [JSON.stringify(payload)],
  );
  return res.rows[0]!.r;
}

async function hawkerBalance(): Promise<number> {
  const res = await pg.query<{ b: string }>("select public.hawker_balance($1)::text as b", [hawker]);
  return Number(res.rows[0]!.b);
}

async function supplierBalance(): Promise<number> {
  const res = await pg.query<{ b: string }>("select public.supplier_balance($1)::text as b", [supplier]);
  return Number(res.rows[0]!.b);
}

async function cashBalance(): Promise<number> {
  const res = await pg.query<{ b: string }>(
    "select current_balance::text as b from public.cash_accounts where id = $1",
    [cash],
  );
  return Number(res.rows[0]!.b);
}

describe("returns", () => {
  it("starts with 6kg in stock and a 800 receivable after the sale", async () => {
    const s = await stockOf(pg, business, product);
    expect(Number(s.qty)).toBe(6);
    expect(await hawkerBalance()).toBe(800);
    expect(await supplierBalance()).toBe(1000);
  });

  it("posts a credit sales return: stock back in and receivable reduced", async () => {
    const r = await postReturn("post_sales_return", {
      business_id: business,
      hawker_id: hawker,
      refund_mode: "credit",
      items: [{ product_id: product, qty: 2, unit: "kg", unit_price: 200 }],
    });
    expect(Number(r.total)).toBe(400);

    expect(Number((await stockOf(pg, business, product)).qty)).toBe(8);
    expect(await hawkerBalance()).toBe(400);
    expect(Number((await stockOf(pg, business, product)).avg)).toBe(100);
  });

  it("posts a cash sales return: stock back, cash out, no ledger change", async () => {
    await postReturn("post_sales_return", {
      business_id: business,
      hawker_id: hawker,
      refund_mode: "cash",
      cash_account_id: cash,
      items: [{ product_id: product, qty: 1, unit: "kg", unit_price: 200 }],
    });

    expect(Number((await stockOf(pg, business, product)).qty)).toBe(9);
    expect(await cashBalance()).toBe(-200);
    expect(await hawkerBalance()).toBe(400);
  });

  it("is idempotent on the sales return key", async () => {
    const payload = {
      business_id: business,
      hawker_id: hawker,
      refund_mode: "credit",
      idempotency_key: "ret-key-1",
      items: [{ product_id: product, qty: 1, unit: "kg", unit_price: 200 }],
    };
    const first = await postReturn("post_sales_return", payload);
    const second = await postReturn("post_sales_return", payload);
    expect(first.idempotency_hit).toBe(false);
    expect(second.idempotency_hit).toBe(true);
    expect(second.return_id).toBe(first.return_id);
    // stock moved exactly once (9 + 1 = 10)
    expect(Number((await stockOf(pg, business, product)).qty)).toBe(10);
  });

  it("posts a credit purchase return: stock out and payable reduced", async () => {
    const r = await postReturn("post_purchase_return", {
      business_id: business,
      supplier_id: supplier,
      refund_mode: "credit",
      items: [{ product_id: product, qty: 3, unit: "kg" }],
    });
    expect(Number(r.total)).toBe(300);

    expect(Number((await stockOf(pg, business, product)).qty)).toBe(7);
    expect(await supplierBalance()).toBe(700);
  });

  it("rejects a return that would drive stock negative", async () => {
    await expect(
      postReturn("post_purchase_return", {
        business_id: business,
        supplier_id: supplier,
        refund_mode: "credit",
        items: [{ product_id: product, qty: 100, unit: "kg" }],
      }),
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);
  });
});
