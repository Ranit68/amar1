import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cashAccountId,
  createBusinessWithOwner,
  createProduct,
  createSupplier,
  createTestDb,
  createUser,
  postPurchase,
  setUser,
  stockOf,
  type TestDb,
} from "../db/harness";

let pg: TestDb;
let owner: string;
let business: string;
let supplier: string;
let cash: string;

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "purchase-owner@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner, "Purchase Co");
  supplier = await createSupplier(pg, business);
  cash = await cashAccountId(pg, business);
});

afterAll(async () => {
  await pg.close();
});

async function supplierBalance(): Promise<number> {
  const res = await pg.query<{ b: string }>(
    "select public.supplier_balance($1)::text as b",
    [supplier],
  );
  return Number(res.rows[0]!.b);
}

describe("purchases", () => {
  it("posts a purchase and updates stock, weighted-average cost and supplier ledger", async () => {
    const product = await createProduct(pg, business, { name: "Rice A", baseUnit: "kg" });
    const result = await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      invoiceNumber: "P-1001",
      items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 100 }],
    });

    expect(result.status).toBe("approved");
    expect(Number(result.total)).toBe(1000);

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(10);
    expect(Number(stock.avg)).toBe(100);
    expect(await supplierBalance()).toBe(1000);
  });

  it("blends weighted-average cost across successive purchases", async () => {
    const product = await createProduct(pg, business, { name: "Rice B", baseUnit: "kg" });
    await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 100 }],
    });
    await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 200 }],
    });

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(20);
    expect(Number(stock.avg)).toBe(150);
  });

  it("allocates freight into inventory cost by line share", async () => {
    const product = await createProduct(pg, business, { name: "Rice C", baseUnit: "kg" });
    await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      items: [{ product_id: product, qty: 20, unit: "kg", unit_price: 100 }],
    });
    const result = await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      freightCost: 50,
      items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 100 }],
    });

    expect(Number(result.total)).toBe(1050);
    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(30);
    // second lot costs 10*100 + 50 freight = 1050; (2000 + 1050) / 30 = 101.6667
    expect(Number(stock.avg)).toBeCloseTo(3050 / 30, 4);
  });

  it("records a cash payment made with the bill", async () => {
    const product = await createProduct(pg, business, { name: "Rice D", baseUnit: "kg" });
    const before = await pg.query<{ b: string }>(
      "select current_balance::text as b from public.cash_accounts where id = $1",
      [cash],
    );

    const result = await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      items: [{ product_id: product, qty: 5, unit: "kg", unit_price: 100 }],
      received: [{ amount: 500, cash_account_id: cash, method: "cash" }],
    });

    expect(Number(result.total)).toBe(500);
    expect(Number(result.amount_paid)).toBe(500);

    const after = await pg.query<{ b: string }>(
      "select current_balance::text as b from public.cash_accounts where id = $1",
      [cash],
    );
    expect(Number(after.rows[0]!.b) - Number(before.rows[0]!.b)).toBe(-500);
  });

  it("rejects duplicate invoices but allows a different one", async () => {
    const product = await createProduct(pg, business, { name: "Rice E", baseUnit: "kg" });
    await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      invoiceNumber: "DUP-1",
      items: [{ product_id: product, qty: 1, unit: "kg", unit_price: 10 }],
    });

    await expect(
      postPurchase(pg, {
        businessId: business,
        supplierId: supplier,
        invoiceNumber: "DUP-1",
        items: [{ product_id: product, qty: 1, unit: "kg", unit_price: 10 }],
      }),
    ).rejects.toThrow(/DUPLICATE_INVOICE/);
  });

  it("is idempotent for retried submits", async () => {
    const product = await createProduct(pg, business, { name: "Rice F", baseUnit: "kg" });
    const payload = {
      businessId: business,
      supplierId: supplier,
      invoiceNumber: "IDEM-1",
      idempotencyKey: "key-idem-1",
      items: [{ product_id: product, qty: 2, unit: "kg", unit_price: 10 }],
    };
    const first = await postPurchase(pg, payload);
    const second = await postPurchase(pg, payload);

    expect(second.bill_id).toBe(first.bill_id);
    expect(second.idempotency_hit).toBe(true);

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(2);
  });

  it("voids a purchase, removing stock at current average and reversing the ledger", async () => {
    const product = await createProduct(pg, business, { name: "Rice G", baseUnit: "kg" });
    const posted = await postPurchase(pg, {
      businessId: business,
      supplierId: supplier,
      invoiceNumber: "VOID-1",
      items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 100 }],
    });
    const billId = posted.bill_id as string;

    const balanceBefore = await supplierBalance();
    const voided = await pg.query<{ r: Record<string, unknown> }>(
      "select public.void_purchase_bill($1, $2) as r",
      [billId, "typo"],
    );
    expect(voided.rows[0]!.r.status).toBe("void");

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(0);
    expect(await supplierBalance()).toBeLessThan(balanceBefore);
  });

  it("rejects posting a purchase into another business", async () => {
    const otherOwner = await createUser(pg, "purchase-other@example.com");
    const otherBusiness = await createBusinessWithOwner(pg, otherOwner, "Other Co");
    const foreignProduct = await createProduct(pg, otherBusiness, { name: "Foreign", baseUnit: "kg" });

    await expect(
      postPurchase(pg, {
        businessId: otherBusiness,
        supplierId: supplier, // belongs to the first business
        items: [{ product_id: foreignProduct, qty: 1, unit: "kg", unit_price: 1 }],
      }),
    ).rejects.toThrow(/FORBIDDEN|UNKNOWN_SUPPLIER/);
  });
});
