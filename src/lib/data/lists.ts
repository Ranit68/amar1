import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface ProductRow {
  id: string;
  name: string;
  nameBn: string | null;
  sku: string;
  baseUnit: string;
  purchaseUnit: string;
  sellUnit: string;
  minStock: number;
  isActive: boolean;
  categoryName: string | null;
}

export async function listProducts(businessId: string): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, name_bn, sku, base_unit, purchase_unit, sell_unit, min_stock, is_active, category:categories(name)",
    )
    .eq("business_id", businessId)
    .order("name", { ascending: true })
    .returns<
      Array<{
        id: string;
        name: string;
        name_bn: string | null;
        sku: string;
        base_unit: string;
        purchase_unit: string;
        sell_unit: string;
        min_stock: number;
        is_active: boolean;
        category: { name: string } | null;
      }>
    >();

  if (error) throw new Error(error.message);

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nameBn: p.name_bn,
    sku: p.sku,
    baseUnit: p.base_unit,
    purchaseUnit: p.purchase_unit,
    sellUnit: p.sell_unit,
    minStock: Number(p.min_stock),
    isActive: p.is_active,
    categoryName: p.category?.name ?? null,
  }));
}

export interface CategoryOption {
  id: string;
  name: string;
}

export async function listCategories(businessId: string): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("business_id", businessId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}

export interface HawkerRow {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: number | null;
  creditDays: number;
  isActive: boolean;
  balance: number;
}

export async function listHawkers(businessId: string): Promise<HawkerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hawkers")
    .select("id, name, phone, credit_limit, credit_days, is_active")
    .eq("business_id", businessId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const balances = await Promise.all(
    rows.map((h) =>
      supabase.rpc("hawker_balance", { p_hawker_id: h.id }).then((r) => ({
        id: h.id,
        balance: Number(r.data ?? 0),
      })),
    ),
  );
  const balanceMap = new Map(balances.map((b) => [b.id, b.balance]));

  return rows.map((h) => ({
    id: h.id,
    name: h.name,
    phone: h.phone,
    creditLimit: h.credit_limit === null ? null : Number(h.credit_limit),
    creditDays: h.credit_days,
    isActive: h.is_active,
    balance: balanceMap.get(h.id) ?? 0,
  }));
}

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  creditDays: number;
  isActive: boolean;
  balance: number;
}

export async function listSuppliers(businessId: string): Promise<SupplierRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, phone, credit_days, is_active")
    .eq("business_id", businessId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const balances = await Promise.all(
    rows.map((s) =>
      supabase.rpc("supplier_balance", { p_supplier_id: s.id }).then((r) => ({
        id: s.id,
        balance: Number(r.data ?? 0),
      })),
    ),
  );
  const balanceMap = new Map(balances.map((b) => [b.id, b.balance]));

  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone,
    creditDays: s.credit_days,
    isActive: s.is_active,
    balance: balanceMap.get(s.id) ?? 0,
  }));
}

export interface InventoryRow {
  productId: string;
  name: string;
  nameBn: string | null;
  unit: string;
  qty: number;
  avgCost: number;
  value: number;
}

export async function listInventory(businessId: string): Promise<InventoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_balances")
    .select("product_id, qty, avg_cost, product:products(name, name_bn, base_unit)")
    .eq("business_id", businessId)
    .returns<
      Array<{
        product_id: string;
        qty: number;
        avg_cost: number;
        product: { name: string; name_bn: string | null; base_unit: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((b) => b.product)
    .map((b) => ({
      productId: b.product_id,
      name: b.product!.name,
      nameBn: b.product!.name_bn,
      unit: b.product!.base_unit,
      qty: Number(b.qty),
      avgCost: Number(b.avg_cost),
      value: Number(b.qty) * Number(b.avg_cost),
    }))
    .sort((a, b) => b.value - a.value);
}

export interface SalesRow {
  id: string;
  invoiceNumber: string | null;
  date: string;
  hawkerName: string;
  total: number;
  outstanding: number;
  paymentStatus: string;
  status: string;
}

export async function listSales(businessId: string, limit = 100): Promise<SalesRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_bills")
    .select(
      "id, invoice_number, invoice_date, total, outstanding, payment_status, status, hawker:hawkers(name)",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<
      Array<{
        id: string;
        invoice_number: string | null;
        invoice_date: string;
        total: number;
        outstanding: number;
        payment_status: string;
        status: string;
        hawker: { name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    date: r.invoice_date,
    hawkerName: r.hawker?.name ?? "—",
    total: Number(r.total),
    outstanding: Number(r.outstanding),
    paymentStatus: r.payment_status,
    status: r.status,
  }));
}

export interface PurchaseRow {
  id: string;
  invoiceNumber: string | null;
  date: string;
  supplierName: string;
  total: number;
  outstanding: number;
  paymentStatus: string;
  status: string;
}

export async function listPurchases(businessId: string, limit = 100): Promise<PurchaseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_bills")
    .select(
      "id, invoice_number, invoice_date, total, outstanding, payment_status, status, supplier:suppliers(name)",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<
      Array<{
        id: string;
        invoice_number: string | null;
        invoice_date: string;
        total: number;
        outstanding: number;
        payment_status: string;
        status: string;
        supplier: { name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    date: r.invoice_date,
    supplierName: r.supplier?.name ?? "—",
    total: Number(r.total),
    outstanding: Number(r.outstanding),
    paymentStatus: r.payment_status,
    status: r.status,
  }));
}

export interface PaymentRow {
  id: string;
  date: string;
  partyType: "customer" | "supplier";
  partyName: string;
  amount: number;
  method: string;
  referenceNo: string | null;
}

export async function listRecentPayments(businessId: string, limit = 20): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const [cust, supp] = await Promise.all([
    supabase
      .from("customer_payments")
      .select("id, paid_at, amount, method, reference_no, hawker:hawkers(name)")
      .eq("business_id", businessId)
      .eq("status", "posted")
      .order("paid_at", { ascending: false })
      .limit(limit)
      .returns<
        Array<{
          id: string;
          paid_at: string;
          amount: number;
          method: string;
          reference_no: string | null;
          hawker: { name: string } | null;
        }>
      >(),
    supabase
      .from("supplier_payments")
      .select("id, paid_at, amount, method, reference_no, supplier:suppliers(name)")
      .eq("business_id", businessId)
      .eq("status", "posted")
      .order("paid_at", { ascending: false })
      .limit(limit)
      .returns<
        Array<{
          id: string;
          paid_at: string;
          amount: number;
          method: string;
          reference_no: string | null;
          supplier: { name: string } | null;
        }>
      >(),
  ]);
  if (cust.error) throw new Error(cust.error.message);
  if (supp.error) throw new Error(supp.error.message);

  const rows: PaymentRow[] = [
    ...(cust.data ?? []).map((p) => ({
      id: p.id,
      date: p.paid_at,
      partyType: "customer" as const,
      partyName: p.hawker?.name ?? "—",
      amount: Number(p.amount),
      method: p.method,
      referenceNo: p.reference_no,
    })),
    ...(supp.data ?? []).map((p) => ({
      id: p.id,
      date: p.paid_at,
      partyType: "supplier" as const,
      partyName: p.supplier?.name ?? "—",
      amount: Number(p.amount),
      method: p.method,
      referenceNo: p.reference_no,
    })),
  ];

  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
