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
  type TestDb,
} from "../db/harness";

let pg: TestDb;
let owner: string;
let business: string;
let hawker: string;
let cash: string;
let billId: string;

const DAY = "2026-01-15";

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "money-owner@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner, "Money Co");
  const supplier = await createSupplier(pg, business);
  hawker = await createHawker(pg, business);
  cash = await cashAccountId(pg, business);

  const product = await createProduct(pg, business, { name: "Money Rice", baseUnit: "kg" });
  await postPurchase(pg, {
    businessId: business,
    supplierId: supplier,
    items: [{ product_id: product, qty: 20, unit: "kg", unit_price: 100 }],
  });
  const sale = await postSale(pg, {
    businessId: business,
    hawkerId: hawker,
    invoiceNumber: "M-1",
    invoiceDate: DAY,
    items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 200 }],
  });
  billId = sale.bill_id as string;
});

afterAll(async () => {
  await pg.close();
});

describe("payments, expenses and closing", () => {
  it("records a customer payment, allocates it to a bill and moves cash", async () => {
    const res = await pg.query<{ r: Record<string, unknown> }>(
      "select public.post_customer_payment($1::jsonb) as r",
      [
        JSON.stringify({
          business_id: business,
          hawker_id: hawker,
          amount: 1500,
          method: "cash",
          cash_account_id: cash,
          paid_at: `${DAY}T11:00:00+05:30`,
          allocations: [{ ref_id: billId, amount: 1500 }],
        }),
      ],
    );
    expect(Number(res.rows[0]!.r.allocated)).toBe(1500);

    const bill = await pg.query<{ outstanding: string; payment_status: string }>(
      "select outstanding::text, payment_status from public.sales_bills where id = $1",
      [billId],
    );
    expect(Number(bill.rows[0]!.outstanding)).toBe(500);
    expect(bill.rows[0]!.payment_status).toBe("partial");
  });

  it("rejects allocating more than a bill's outstanding balance", async () => {
    await expect(
      pg.query("select public.post_customer_payment($1::jsonb)", [
        JSON.stringify({
          business_id: business,
          hawker_id: hawker,
          amount: 1000,
          method: "cash",
          cash_account_id: cash,
          allocations: [{ ref_id: billId, amount: 1000 }],
        }),
      ]),
    ).rejects.toThrow(/ALLOCATION_EXCEEDS_OUTSTANDING/);
  });

  it("records an operating expense as a cash outflow", async () => {
    const res = await pg.query<{ r: Record<string, unknown> }>(
      "select public.record_expense($1::jsonb) as r",
      [
        JSON.stringify({
          business_id: business,
          amount: 300,
          category: "Rent",
          kind: "operating",
          description: "Shop rent",
          expense_date: DAY,
          payment_method: "cash",
          cash_account_id: cash,
        }),
      ],
    );
    expect(res.rows[0]!.r.expense_id).toBeTruthy();
  });

  it("computes a daily closing with expected cash and variance", async () => {
    const res = await pg.query<{ r: Record<string, unknown> }>(
      "select public.confirm_daily_closing($1, $2, $3) as r",
      [business, DAY, 1150],
    );
    const r = res.rows[0]!.r;

    expect(Number(r.expected_cash)).toBe(1200); // +1500 collected, -300 expense
    expect(Number(r.difference)).toBe(-50);
    expect(Number(r.net_operating_profit)).toBe(700); // 1000 gross profit - 300 opex

    const closing = await pg.query<{ sales_total: string; gross_profit: string }>(
      "select sales_total::text, gross_profit::text from public.daily_closings where business_id = $1 and closing_date = $2",
      [business, DAY],
    );
    expect(Number(closing.rows[0]!.sales_total)).toBe(2000);
    expect(Number(closing.rows[0]!.gross_profit)).toBe(1000);
  });
});
