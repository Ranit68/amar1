import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";

interface SalesTodayRow {
  total: number;
  gross_profit: number;
}

interface SalesReturnItem {
  qty_base: number;
  unit_cost: number;
}

interface SalesReturnRow {
  total: number;
  items: SalesReturnItem[] | null;
}
interface LowStockRow {
  product_id: string;
  qty: number;
  avg_cost: number;
  product: {
    name: string;
    name_bn: string | null;
    base_unit: string;
    min_stock: number;
  } | null;
}
interface RecentSaleRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total: number;
  outstanding: number;
  payment_status: string;
  hawker: { name: string } | null;
}

export interface LowStockItem {
  productId: string;
  name: string;
  nameBn: string | null;
  unit: string;
  qty: number;
  minStock: number;
}

export interface RecentSale {
  id: string;
  invoiceNumber: string | null;
  date: string;
  hawkerName: string;
  total: number;
  outstanding: number;
  paymentStatus: string;
}

export interface DashboardData {
  todaySales: number;
  todayProfit: number;
  receivables: number;
  payables: number;
  lowStock: LowStockItem[];
  recentSales: RecentSale[];
  lowStockCount: number;
}

export async function getDashboard(businessId: string): Promise<DashboardData> {
  const supabase = await createClient();
  const today = todayISO();

  const [salesToday, salesReturns, receivables, payables, balances, recent] = await Promise.all([
    supabase
      .from("sales_bills")
      .select("total, gross_profit")
      .eq("business_id", businessId)
      .eq("invoice_date", today)
      .eq("status", "approved")
      .returns<SalesTodayRow[]>(),
    supabase
      .from("sales_returns")
      .select("total, items")
      .eq("business_id", businessId)
      .eq("return_date", today)
      .eq("status", "posted")
      .returns<SalesReturnRow[]>(),
    supabase.rpc("total_receivables", { p_business_id: businessId }),
    supabase.rpc("total_payables", { p_business_id: businessId }),
    supabase
      .from("inventory_balances")
      .select(
        "product_id, qty, avg_cost, product:products(name, name_bn, base_unit, min_stock)",
      )
      .eq("business_id", businessId)
      .returns<LowStockRow[]>(),
    supabase
      .from("sales_bills")
      .select(
        "id, invoice_number, invoice_date, total, outstanding, payment_status, hawker:hawkers(name)",
      )
      .eq("business_id", businessId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<RecentSaleRow[]>(),
  ]);

  const sum = (rows: { total?: number; outstanding?: number; gross_profit?: number }[], key: "total" | "outstanding" | "gross_profit") =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const lowStockAll = (balances.data ?? [])
    .filter((b) => b.product && Number(b.qty) <= Number(b.product.min_stock))
    .map<LowStockItem>((b) => ({
      productId: b.product_id,
      name: b.product!.name,
      nameBn: b.product!.name_bn,
      unit: b.product!.base_unit,
      qty: Number(b.qty),
      minStock: Number(b.product!.min_stock),
    }))
    .sort((a, b) => a.qty - b.qty);

  const grossSales = sum(salesToday.data ?? [], "total");
  const grossProfit = sum(salesToday.data ?? [], "gross_profit");
  const returnsTotal = sum(salesReturns.data ?? [], "total");
  const returnsCost = (salesReturns.data ?? []).reduce(
    (acc, r) =>
      acc +
      (r.items ?? []).reduce(
        (lineAcc, it) => lineAcc + Number(it.qty_base ?? 0) * Number(it.unit_cost ?? 0),
        0,
      ),
    0,
  );

  return {
    todaySales: grossSales - returnsTotal,
    todayProfit: grossProfit - (returnsTotal - returnsCost),
    receivables: Number(receivables.data ?? 0),
    payables: Number(payables.data ?? 0),
    lowStock: lowStockAll.slice(0, 8),
    lowStockCount: lowStockAll.length,
    recentSales: (recent.data ?? []).map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      date: r.invoice_date,
      hawkerName: r.hawker?.name ?? "—",
      total: Number(r.total),
      outstanding: Number(r.outstanding),
      paymentStatus: r.payment_status,
    })),
  };
}
