import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, setUser, type TestDb } from "../db/harness";

let pg: TestDb;

beforeAll(async () => {
  pg = await createTestDb();
});

afterAll(async () => {
  await pg.close();
});

describe("tenancy", () => {
  it("auto-provisions a profile when an auth user is created", async () => {
    const res = await pg.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, $2::jsonb) returning id`,
      ["tenant@example.com", JSON.stringify({ full_name: "Tenant User" })],
    );
    const uid = res.rows[0]!.id;

    const profile = await pg.query<{ full_name: string }>(
      "select full_name from public.profiles where id = $1",
      [uid],
    );
    expect(profile.rows[0]?.full_name).toBe("Tenant User");
  });

  it("creates a business, makes the caller owner and seeds defaults", async () => {
    const owner = await createUser(pg, "tenant-owner@example.com");
    await setUser(pg, owner);

    const res = await pg.query<{ b: string }>(
      "select public.create_business($1) as b",
      ["Tenant Store"],
    );
    const businessId = res.rows[0]!.b;
    expect(businessId).toBeTruthy();

    const business = await pg.query<{ name: string }>(
      "select name from public.businesses where id = $1",
      [businessId],
    );
    expect(business.rows[0]!.name).toBe("Tenant Store");

    const member = await pg.query<{ role: string; status: string }>(
      "select role, status from public.business_members where business_id = $1 and user_id = $2",
      [businessId, owner],
    );
    expect(member.rows[0]!.role).toBe("owner");
    expect(member.rows[0]!.status).toBe("active");

    const accounts = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.cash_accounts where business_id = $1",
      [businessId],
    );
    expect(accounts.rows[0]!.n).toBe(3);
  });

  it("rejects a blank business name", async () => {
    const owner = await createUser(pg, "tenant-blank@example.com");
    await setUser(pg, owner);
    await expect(pg.query("select public.create_business($1)", ["   "])).rejects.toThrow(
      /BUSINESS_NAME_REQUIRED/,
    );
  });

  it("rejects create_business for an unauthenticated caller", async () => {
    await setUser(pg, null);
    await expect(pg.query("select public.create_business($1)", ["No Auth"])).rejects.toThrow(
      /NOT_AUTHENTICATED/,
    );
  });
});
