import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
let owner2: string;
let manager: string;
let businessId: string;

beforeAll(async () => {
  pg = await createTestDb();
  owner = await createUser(pg, "admin-owner@example.com");
  await setUser(pg, owner);
  businessId = await createBusinessWithOwner(pg, owner, "Admin Store");
});

afterAll(async () => {
  await pg.close();
});

describe("update_business", () => {
  it("lets an owner rename the business and change its locale", async () => {
    await setUser(pg, owner);
    const res = await pg.query<{ r: Record<string, unknown> }>(
      "select public.update_business($1, $2, $3) as r",
      [businessId, "Admin Store v2", "en"],
    );
    expect(res.rows[0]!.r.updated).toBe(true);

    const row = await pg.query<{ name: string; locale: string }>(
      "select name, locale from public.businesses where id = $1",
      [businessId],
    );
    expect(row.rows[0]!.name).toBe("Admin Store v2");
    expect(row.rows[0]!.locale).toBe("en");
  });

  it("rejects an invalid locale", async () => {
    await setUser(pg, owner);
    await expect(
      pg.query("select public.update_business($1, null, $2)", [businessId, "fr"]),
    ).rejects.toThrow(/INVALID_LOCALE/);
  });

  it("denies staff without settings.manage", async () => {
    manager = await createUser(pg, "admin-manager@example.com");
    await pg.query(
      `insert into public.business_members (business_id, user_id, role, member_permissions)
       values ($1, $2, 'staff', array[]::text[])`,
      [businessId, manager],
    );
    await setUser(pg, manager);
    const before = await pg.query<{ name: string }>(
      "select name from public.businesses where id = $1",
      [businessId],
    );
    await expect(
      pg.query("select public.update_business($1, 'Hacked', null)", [businessId]),
    ).rejects.toThrow(/FORBIDDEN|permission/);

    const after = await pg.query<{ name: string }>(
      "select name from public.businesses where id = $1",
      [businessId],
    );
    expect(after.rows[0]!.name).toBe(before.rows[0]!.name);
  });
});

describe("invite_member", () => {
  beforeEach(async () => {
    await setUser(pg, owner);
  });

  it("invites an existing user by email as a pending member", async () => {
    owner2 = await createUser(pg, "future@example.com");
    const res = await pg.query<{ r: Record<string, unknown> }>(
      "select public.invite_member($1, $2, $3) as r",
      [businessId, "future@example.com", "staff"],
    );
    expect(res.rows[0]!.r.status).toBe("pending");

    const member = await pg.query<{ role: string; status: string; invited_by: string | null }>(
      `select role, status, invited_by from public.business_members
        where business_id = $1 and user_id = $2`,
      [businessId, owner2],
    );
    expect(member.rows[0]!.role).toBe("staff");
    expect(member.rows[0]!.status).toBe("pending");
    expect(member.rows[0]!.invited_by).toBe(owner);
  });

  it("matches email case-insensitively and rejects a duplicate invite", async () => {
    // owner2 already pending; a differently-cased email must still collide.
    await expect(
      pg.query("select public.invite_member($1, $2, $3)", [businessId, "FUTURE@example.com", "manager"]),
    ).rejects.toThrow(/ALREADY_MEMBER/);
  });

  it("rejects an email with no account", async () => {
    await expect(
      pg.query("select public.invite_member($1, $2, $3)", [businessId, "nobody@example.com", "staff"]),
    ).rejects.toThrow(/USER_NOT_FOUND/);
  });

  it("denies staff without users.manage", async () => {
    await setUser(pg, manager);
    await expect(
      pg.query("select public.invite_member($1, $2, $3)", [businessId, "future@example.com", "staff"]),
    ).rejects.toThrow(/FORBIDDEN|permission/);
  });
});

describe("create_stock_count", () => {
  let supplier: string;
  let product: string;

  beforeAll(async () => {
    await setUser(pg, owner);
    supplier = await createSupplier(pg, businessId, "Count Supplier");
    product = await createProduct(pg, businessId, { name: "Rice", baseUnit: "kg" });
    const cash = await cashAccountId(pg, businessId);
    await postPurchase(pg, {
      businessId,
      supplierId: supplier,
      items: [{ product_id: product, qty: 10, unit: "kg", unit_price: 100 }],
      received: [{ amount: 1000, cash_account_id: cash }],
      idempotencyKey: "count-purchase-1",
    });
  });

  it("opens a draft count with system quantities and confirms the diff", async () => {
    await setUser(pg, owner);
    const before = await stockOf(pg, businessId, product);
    expect(Number(before.qty)).toBe(10);

    const res = await pg.query<{ r: Record<string, unknown> }>(
      "select public.create_stock_count($1::jsonb) as r",
      [JSON.stringify({ business_id: businessId, items: [{ product_id: product, counted_qty: 4 }] })],
    );
    const countId = res.rows[0]!.r.count_id;
    expect(countId).toBeTruthy();

    const items = await pg.query<{ system_qty: string }>(
      "select system_qty::text from public.stock_count_items where count_id = $1 and product_id = $2",
      [countId, product],
    );
    expect(Number(items.rows[0]!.system_qty)).toBe(10);

    const confirmed = await pg.query<{ r: Record<string, unknown> }>(
      "select public.confirm_stock_count($1, $2) as r",
      [countId, "manual count"],
    );
    expect(confirmed.rows[0]!.r.status).toBe("confirmed");

    const after = await stockOf(pg, businessId, product);
    expect(Number(after.qty)).toBe(4);
  });

  it("rejects a second draft count on the same date", async () => {
    await setUser(pg, owner);
    await pg.query(
      "select public.create_stock_count($1::jsonb)",
      [JSON.stringify({ business_id: businessId, items: [{ product_id: product, counted_qty: 4 }] })],
    );
    await expect(
      pg.query(
        "select public.create_stock_count($1::jsonb)",
        [JSON.stringify({ business_id: businessId, items: [{ product_id: product, counted_qty: 9 }] })],
      ),
    ).rejects.toThrow(/DUPLICATE_COUNT/);
  });

  it("rejects a product that does not belong to the business", async () => {
    await setUser(pg, owner);
    const other = await createProduct(pg, businessId, { name: "Strange", baseUnit: "kg" });
    await pg.query(
      `delete from public.products where id = $1`,
      [other],
    );
    await expect(
      pg.query(
        "select public.create_stock_count($1::jsonb)",
        [JSON.stringify({ business_id: businessId, items: [{ product_id: other, counted_qty: 1 }] })],
      ),
    ).rejects.toThrow(/UNKNOWN_PRODUCT/);
  });

  it("denies staff without inventory.write", async () => {
    await setUser(pg, manager);
    await expect(
      pg.query(
        "select public.create_stock_count($1::jsonb)",
        [JSON.stringify({ business_id: businessId, items: [{ product_id: product, counted_qty: 1 }] })],
      ),
    ).rejects.toThrow(/FORBIDDEN|permission/);
  });
});