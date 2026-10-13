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

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "sales-owner@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner, "Sales Co");
  supplier = await createSupplier(pg, business);
  hawker = await createHawker(pg, business);
  cash = await cashAccountId(pg, business);
});

afterAll(async () => {
  await pg.close();
});

async function seedStock(product: string, qty: number, price: number): Promise<void> {
  await postPurchase(pg, {
    businessId: business,
    supplierId: supplier,
    items: [{ product_id: product, qty, unit: "kg", unit_price: price }],
  });
}

async function hawkerBalance(): Promise<number> {
  const res = await pg.query<{ b: string }>("select public.hawker_balance($1)::text as b", [hawker]);
  return Number(res.rows[0]!.b);
}

describe("sales", () => {
  it("posts a credit sale: deducts stock, books COGS and gross profit, updates the hawker ledger", async () => {
    const product = await createProduct(pg, business, { name: "Sale Rice 1", baseUnit: "kg" });
    await seedStock(product, 20, 100);

    const result = await postSale(pg, {
      businessId: business,
      hawkerId: hawker,
      invoiceNumber: "S-1",
      items: [{ product_id: product, qty: 5, unit: "kg", unit_price: 200 }],
    });

    expect(result.status).toBe("approved");
    expect(Number(result.total)).toBe(1000);
    expect(Number(result.cost_of_goods)).toBe(500);
    expect(Number(result.gross_profit)).toBe(500);

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(15);
    expect(Number(stock.avg)).toBe(100);
    expect(await hawkerBalance()).toBe(1000);
  });

  it("captures a partial cash receipt with the bill", async () => {
    const product = await createProduct(pg, business, { name: "Sale Rice 2", baseUnit: "kg" });
    await seedStock(product, 10, 100);

    const result = await postSale(pg, {
      businessId: business,
      hawkerId: hawker,
      items: [{ product_id: product, qty: 5, unit: "kg", unit_price: 200 }],
      received: [{ amount: 400, cash_account_id: cash, method: "cash" }],
    });

    expect(Number(result.amount_received)).toBe(400);
    expect(Number(result.outstanding)).toBe(600);

    const bill = await pg.query<{ payment_status: string }>(
      "select payment_status from public.sales_bills where id = $1",
      [result.bill_id as string],
    );
    expect(bill.rows[0]!.payment_status).toBe("partial");

    const cashRow = await pg.query<{ b: string }>(
      "select current_balance::text as b from public.cash_accounts where id = $1",
      [cash],
    );
    expect(Number(cashRow.rows[0]!.b)).toBe(400);
  });

  it("enforces the hawker credit limit unless overridden", async () => {
    const product = await createProduct(pg, business, { name: "Sale Rice 3", baseUnit: "kg" });
    await seedStock(product, 50, 100);
    await pg.query("update public.hawkers set credit_limit = 100 where id = $1", [hawker]);

    await expect(
      postSale(pg, {
        businessId: business,
        hawkerId: hawker,
        items: [{ product_id: product, qty: 5, unit: "kg", unit_price: 200 }],
      }),
    ).rejects.toThrow(/CREDIT_LIMIT_EXCEEDED/);

    const ok = await postSale(pg, {
      businessId: business,
      hawkerId: hawker,
      items: [{ product_id: product, qty: 1, unit: "kg", unit_price: 50 }],
      allowCreditOverride: true,
    });
    expect(ok.status).toBe("approved");

    await pg.query("update public.hawkers set credit_limit = null where id = $1", [hawker]);
  });

  it("blocks selling more than is in stock and leaves stock untouched", async () => {
    const product = await createProduct(pg, business, { name: "Sale Rice 4", baseUnit: "kg" });
    await seedStock(product, 3, 100);

    await expect(
      postSale(pg, {
        businessId: business,
        hawkerId: hawker,
        items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 200 }],
      }),
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(3);
  });

  it("voids a sale: returns stock and reverses the ledger", async () => {
    const product = await createProduct(pg, business, { name: "Sale Rice 5", baseUnit: "kg" });
    await seedStock(product, 10, 100);
    const posted = await postSale(pg, {
      businessId: business,
      hawkerId: hawker,
      invoiceNumber: "VOID-SALE-1",
      items: [{ product_id: product, qty: 5, unit: "kg", unit_price: 200 }],
    });

    const balanceBefore = await hawkerBalance();
    const voided = await pg.query<{ r: Record<string, unknown> }>(
      "select public.void_sales_bill($1, $2) as r",
      [posted.bill_id as string, "duplicate entry"],
    );
    expect(voided.rows[0]!.r.status).toBe("void");

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(10);
    expect(await hawkerBalance()).toBeLessThan(balanceBefore);
  });
});
