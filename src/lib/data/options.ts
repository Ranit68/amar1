import "server-only";
import { createClient } from "@/lib/supabase/server";
import { UNIT_SUGGESTIONS } from "@/lib/units";

export interface ProductOption {
  id: string;
  name: string;
  nameBn: string | null;
  baseUnit: string;
  purchaseUnit: string;
  sellUnit: string;
}

export async function listActiveProducts(businessId: string): Promise<ProductOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, name_bn, base_unit, purchase_unit, sell_unit")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nameBn: p.name_bn,
    baseUnit: p.base_unit,
    purchaseUnit: p.purchase_unit,
    sellUnit: p.sell_unit,
  }));
}

export interface ReturnProductOption extends ProductOption {
  avgCost: number;
  unitFactors: Record<string, number | null>;
}

const UNIT_CANON: Record<string, string> = {
  piece: "piece",
  pcs: "piece",
  pieces: "piece",
  dozen: "dozen",
  pair: "pair",
  kg: "kg",
  kilo: "kg",
  kilogram: "kg",
  g: "g",
  gram: "g",
  grams: "g",
  l: "l",
  litre: "l",
  ltr: "l",
  ml: "ml",
  millilitre: "ml",
  bag: "bag",
  box: "box",
};

function normText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonUnit(value: string): string {
  const norm = normText(value);
  return UNIT_CANON[norm] ?? norm;
}

export async function listReturnProducts(businessId: string): Promise<ReturnProductOption[]> {
  const supabase = await createClient();
  const [products, balances, productUnits, dimensions] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, name_bn, base_unit, purchase_unit, sell_unit")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("inventory_balances")
      .select("product_id, avg_cost")
      .eq("business_id", businessId),
    supabase
      .from("product_units")
      .select("product_id, unit_norm, factor_to_base")
      .eq("business_id", businessId),
    supabase.from("unit_dimensions").select("unit, dimension, factor"),
  ]);

  const avgCosts = new Map<string, number>();
  for (const b of balances.data ?? []) {
    avgCosts.set(b.product_id, Number(b.avg_cost ?? 0));
  }

  const unitOverrides = new Map<string, Map<string, number>>();
  for (const pu of productUnits.data ?? []) {
    const key = pu.unit_norm;
    const map = unitOverrides.get(pu.product_id) ?? new Map<string, number>();
    map.set(key, Number(pu.factor_to_base));
    unitOverrides.set(pu.product_id, map);
  }

  const dims = new Map<string, { dimension: string; factor: number }>();
  for (const d of dimensions.data ?? []) {
    dims.set(d.unit, { dimension: d.dimension, factor: Number(d.factor) });
  }

  const units = UNIT_SUGGESTIONS.map((u) => u.unit);

  return (products.data ?? []).map((p) => {
    const baseCanon = canonUnit(p.base_unit);
    const overrides = unitOverrides.get(p.id);
    const unitFactors: Record<string, number | null> = {};
    for (const u of units) {
      const cu = canonUnit(u);
      if (cu === baseCanon || normText(p.base_unit) === normText(u)) {
        unitFactors[u] = 1;
        continue;
      }
      const ov = overrides?.get(normText(cu));
      if (ov != null) {
        unitFactors[u] = ov;
        continue;
      }
      const baseDim = dims.get(baseCanon);
      const unitDim = dims.get(cu);
      unitFactors[u] =
        baseDim && unitDim && baseDim.dimension === unitDim.dimension
          ? unitDim.factor / baseDim.factor
          : null;
    }
    return {
      id: p.id,
      name: p.name,
      nameBn: p.name_bn,
      baseUnit: p.base_unit,
      purchaseUnit: p.purchase_unit,
      sellUnit: p.sell_unit,
      avgCost: avgCosts.get(p.id) ?? 0,
      unitFactors,
    };
  });
}

export interface HawkerOption {
  id: string;
  name: string;
}

export async function listHawkerOptions(businessId: string): Promise<HawkerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hawkers")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface SupplierOption {
  id: string;
  name: string;
}

export async function listSupplierOptions(businessId: string): Promise<SupplierOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface CashAccountOption {
  id: string;
  name: string;
  kind: string;
  balance: number;
}

export async function listCashAccounts(businessId: string): Promise<CashAccountOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_accounts")
    .select("id, name, kind, current_balance")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    balance: Number(a.current_balance),
  }));
}

export interface OpenBillOption {
  id: string;
  invoiceNumber: string | null;
  partnerId: string;
  partnerName: string;
  outstanding: number;
}

export async function listOpenSalesBills(businessId: string): Promise<OpenBillOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_bills")
    .select("id, invoice_number, outstanding, hawker:hawkers(id, name)")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .gt("outstanding", 0.005)
    .order("invoice_date", { ascending: true })
    .returns<
      Array<{
        id: string;
        invoice_number: string | null;
        outstanding: number;
        hawker: { id: string; name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    invoiceNumber: b.invoice_number,
    partnerId: b.hawker?.id ?? "",
    partnerName: b.hawker?.name ?? "—",
    outstanding: Number(b.outstanding),
  }));
}

export async function listOpenPurchaseBills(businessId: string): Promise<OpenBillOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_bills")
    .select("id, invoice_number, outstanding, supplier:suppliers(id, name)")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .gt("outstanding", 0.005)
    .order("invoice_date", { ascending: true })
    .returns<
      Array<{
        id: string;
        invoice_number: string | null;
        outstanding: number;
        supplier: { id: string; name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    invoiceNumber: b.invoice_number,
    partnerId: b.supplier?.id ?? "",
    partnerName: b.supplier?.name ?? "—",
    outstanding: Number(b.outstanding),
  }));
}

export interface ApprovedBillOption {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  partnerId: string | null;
}

export async function listApprovedSalesBills(businessId: string): Promise<ApprovedBillOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_bills")
    .select("id, invoice_number, invoice_date, hawker_id")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .order("invoice_date", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    invoiceNumber: b.invoice_number,
    invoiceDate: b.invoice_date,
    partnerId: b.hawker_id,
  }));
}

export async function listApprovedPurchaseBills(businessId: string): Promise<ApprovedBillOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_bills")
    .select("id, invoice_number, invoice_date, supplier_id")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .order("invoice_date", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id,
    invoiceNumber: b.invoice_number,
    invoiceDate: b.invoice_date,
    partnerId: b.supplier_id,
  }));
}
