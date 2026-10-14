import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cashAccountId,
  createBusinessWithOwner,
  createHawker,
  createProduct,
  createTestDb,
  createUser,
  postSale,
  setUser,
  stockOf,
  type TestDb,
} from "../db/harness";

let pg: TestDb;
let owner: string;
let business: string;
let hawker: string;

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "cost-owner@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner, "Cost Co");
  hawker = await createHawker(pg, business);
  await cashAccountId(pg, business);
});

afterAll(async () => {
  await pg.close();
});

async function setPrice(product: string, type: "purchase" | "sale", price: number): Promise<void> {
  await pg.query("select public.set_product_price($1, $2, $3, $4)", [product, type, "pcs", price]);
}

async function addStock(product: string, qty: number): Promise<void> {
  await pg.query("select public.apply_stock_adjustment($1::jsonb)", [
    JSON.stringify({
      business_id: business,
      product_id: product,
      qty_change: qty,
      adjustment_type: "correction",
      reason: "opening stock",
      apply_now: true,
    }),
  ]);
}

/** Latest purchase price seeds the cost basis without any purchase bill. */
describe("product cost basis", () => {
  it("seeds avg_cost from the buying price on a stock-less product", async () => {
    const product = await createProduct(pg, business, { name: "Cost Seed", baseUnit: "pcs" });
    await setPrice(product, "purchase", 62);
    const stock = await stockOf(pg, business, product);
    expect(Number(stock.qty)).toBe(0);
    expect(Number(stock.avg)).toBe(62);
  });

  it("sells at 65 a product bought at 62 (added via adjustment) and books 3 profit", async () => {
    const product = await createProduct(pg, business, { name: "Biscuit", baseUnit: "pcs" });
    await setPrice(product, "purchase", 62);
    await addStock(product, 1);

    const stock = await stockOf(pg, business, product);
    expect(Number(stock.avg)).toBe(62);

    const result = await postSale(pg, {
      businessId: business,
      hawkerId: hawker,
      items: [{ product_id: product, qty: 1, unit: "pcs", unit_price: 65 }],
    });

    expect(Number(result.total)).toBe(65);
    expect(Number(result.cost_of_goods)).toBe(62);
    expect(Number(result.gross_profit)).toBe(3);
  });
});
