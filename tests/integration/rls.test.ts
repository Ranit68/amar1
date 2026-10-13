import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createBusinessWithOwner,
  createProduct,
  createSupplier,
  createTestDb,
  createUser,
  postPurchase,
  setUser,
  type TestDb,
} from "../db/harness";

let pg: TestDb;
let owner: string;
let stranger: string;
let business: string;

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "rls-owner@example.com");
  stranger = await createUser(pg, "rls-stranger@example.com");
  await setUser(pg, owner);
  business = await createBusinessWithOwner(pg, owner, "RLS Co");
  const supplier = await createSupplier(pg, business);
  const product = await createProduct(pg, business, { name: "RLS Rice", baseUnit: "kg" });
  await postPurchase(pg, {
    businessId: business,
    supplierId: supplier,
    items: [{ product_id: product, qty: 5, unit: "kg", unit_price: 100 }],
  });
});

afterAll(async () => {
  await pg.close();
});

async function countAs(userId: string, table: string): Promise<number> {
  await setUser(pg, userId);
  await pg.exec("set role authenticated");
  const res = await pg.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  await pg.exec("reset role");
  return res.rows[0]!.n;
}

describe("row level security", () => {
  it("lets a member read their business rows", async () => {
    expect(await countAs(owner, "purchase_bills")).toBe(1);
    expect(await countAs(owner, "business_members")).toBe(1);
    expect(await countAs(owner, "products")).toBe(1);
  });

  it("hides all business rows from a non-member", async () => {
    expect(await countAs(stranger, "purchase_bills")).toBe(0);
    expect(await countAs(stranger, "business_members")).toBe(0);
    expect(await countAs(stranger, "products")).toBe(0);
    expect(await countAs(stranger, "cash_accounts")).toBe(0);
  });

  it("gates the audit log behind the audit.view permission", async () => {
    expect(await countAs(owner, "audit_logs")).toBeGreaterThan(0);
    expect(await countAs(stranger, "audit_logs")).toBe(0);
  });

  it("blocks direct writes from non-members and to RPC-only tables", async () => {
    // A non-member must not be able to insert catalog rows.
    await setUser(pg, stranger);
    await pg.exec("set role authenticated");
    await expect(
      pg.query("insert into public.hawkers (business_id, name) values ($1, 'Sneaky')", [business]),
    ).rejects.toThrow(/permission denied|row-level security/i);
    await pg.exec("reset role");

    // Financial / audit tables stay RPC-only: even an owner cannot write them directly.
    await setUser(pg, owner);
    await pg.exec("set role authenticated");
    await expect(
      pg.query(
        "insert into public.audit_logs (business_id, action, entity_type) values ($1, 'x', 'y')",
        [business],
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
    await pg.exec("reset role");
  });

  it("allows a permitted member to write catalog rows", async () => {
    await setUser(pg, owner);
    await pg.exec("set role authenticated");
    await pg.query(
      "insert into public.hawkers (business_id, name) values ($1, 'Direct OK')",
      [business],
    );
    await pg.exec("reset role");
    expect(await countAs(owner, "hawkers")).toBe(1);
  });
});
