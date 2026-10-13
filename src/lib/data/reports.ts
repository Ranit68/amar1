import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";

function firstOfMonth(): string {
  return `${todayISO().slice(0, 7)}-01`;
}

export interface FinancialSummary {
  monthSales: number;
  monthGrossProfit: number;
  monthPurchases: number;
  monthExpenses: number;
  todayCollections: number;
  monthSalesReturns: number;
  monthPurchaseReturns: number;
}

interface ReturnItem {
  qty_base: number;
  unit_cost: number;
}

export async function getFinancialSummary(businessId: string): Promise<FinancialSummary> {
  const supabase = await createClient();
  const start = firstOfMonth();
  const today = todayISO();

  const [sales, purchases, expenses, collections, salesReturns, purchaseReturns] = await Promise.all([
    supabase
      .from("sales_bills")
      .select("total, gross_profit")
      .eq("business_id", businessId)
      .eq("status", "approved")
      .gte("invoice_date", start)
      .returns<Array<{ total: number; gross_profit: number }>>(),
    supabase
      .from("purchase_bills")
      .select("total")
      .eq("business_id", businessId)
      .eq("status", "approved")
      .gte("invoice_date", start)
      .returns<Array<{ total: number }>>(),
    supabase
      .from("expenses")
      .select("amount, expense_date")
      .eq("business_id", businessId)
      .gte("expense_date", start)
      .returns<Array<{ amount: number }>>(),
    supabase
      .from("sales_bills")
      .select("amount_received")
      .eq("business_id", businessId)
      .eq("status", "approved")
      .eq("invoice_date", today)
      .returns<Array<{ amount_received: number }>>(),
    supabase
      .from("sales_returns")
      .select("total, items")
      .eq("business_id", businessId)
      .eq("status", "posted")
      .gte("return_date", start)
      .returns<Array<{ total: number; items: ReturnItem[] }>>(),
    supabase
      .from("purchase_returns")
      .select("total")
      .eq("business_id", businessId)
      .eq("status", "posted")
      .gte("return_date", start)
      .returns<Array<{ total: number }>>(),
  ]);

  const sum = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const grossSales = sum(sales.data ?? [], "total");
  const grossProfit = sum(sales.data ?? [], "gross_profit");
  const grossPurchases = sum(purchases.data ?? [], "total");

  const returnTotal = (salesReturns.data ?? []).reduce((acc, r) => acc + Number(r.total ?? 0), 0);
  const returnCost = (salesReturns.data ?? []).reduce(
    (acc, r) =>
      acc +
      (r.items ?? []).reduce((c, it) => c + Number(it.qty_base ?? 0) * Number(it.unit_cost ?? 0), 0),
    0,
  );
  const grossPurchaseReturns = sum(purchaseReturns.data ?? [], "total");

  return {
    monthSales: grossSales - returnTotal,
    monthGrossProfit: grossProfit - (returnTotal - returnCost),
    monthPurchases: grossPurchases - grossPurchaseReturns,
    monthExpenses: sum(expenses.data ?? [], "amount"),
    todayCollections: sum(collections.data ?? [], "amount_received"),
    monthSalesReturns: returnTotal,
    monthPurchaseReturns: grossPurchaseReturns,
  };
}

export interface TrendPoint {
  month: string;
  label: string;
  sales: number;
  purchases: number;
  expenses: number;
  profit: number;
}

const BN_MONTHS = [
  "জানু",
  "ফেব",
  "মার্চ",
  "এপ্রি",
  "মে",
  "জুন",
  "জুল",
  "আগ",
  "সেপ",
  "অক্টো",
  "নভে",
  "ডিসে",
];

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getMonthlyTrend(businessId: string, months = 6): Promise<TrendPoint[]> {
  const supabase = await createClient();
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const start = `${monthKey(first)}-01`;

  const [sales, purchases, expenses] = await Promise.all([
    supabase
      .from("sales_bills")
      .select("invoice_date, total, gross_profit")
      .eq("business_id", businessId)
      .eq("status", "approved")
      .gte("invoice_date", start)
      .returns<Array<{ invoice_date: string; total: number; gross_profit: number }>>(),
    supabase
      .from("purchase_bills")
      .select("invoice_date, total")
      .eq("business_id", businessId)
      .eq("status", "approved")
      .gte("invoice_date", start)
      .returns<Array<{ invoice_date: string; total: number }>>(),
    supabase
      .from("expenses")
      .select("expense_date, amount")
      .eq("business_id", businessId)
      .gte("expense_date", start)
      .returns<Array<{ expense_date: string; amount: number }>>(),
  ]);

  const buckets = new Map<string, TrendPoint>();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
    const key = monthKey(d);
    buckets.set(key, {
      month: key,
      label: BN_MONTHS[d.getMonth()] ?? "",
      sales: 0,
      purchases: 0,
      expenses: 0,
      profit: 0,
    });
  }

  for (const r of sales.data ?? []) {
    const b = buckets.get(r.invoice_date.slice(0, 7));
    if (b) {
      b.sales += Number(r.total ?? 0);
      b.profit += Number(r.gross_profit ?? 0);
    }
  }
  for (const r of purchases.data ?? []) {
    const b = buckets.get(r.invoice_date.slice(0, 7));
    if (b) b.purchases += Number(r.total ?? 0);
  }
  for (const r of expenses.data ?? []) {
    const b = buckets.get(r.expense_date.slice(0, 7));
    if (b) b.expenses += Number(r.amount ?? 0);
  }

  return Array.from(buckets.values());
}

export interface ExpenseRow {
  id: string;
  date: string;
  category: string;
  amount: number;
  description: string | null;
  paymentMethod: string;
}

export async function listExpenses(businessId: string, limit = 100): Promise<ExpenseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, expense_date, category, amount, description, payment_method")
    .eq("business_id", businessId)
    .order("expense_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id,
    date: e.expense_date,
    category: e.category,
    amount: Number(e.amount),
    description: e.description,
    paymentMethod: e.payment_method,
  }));
}

export interface ClosingRow {
  id: string;
  date: string;
  salesTotal: number;
  collections: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  netProfit: number;
  status: string;
}

export async function listClosings(businessId: string, limit = 30): Promise<ClosingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_closings")
    .select(
      "id, closing_date, sales_total, collections, expected_cash, counted_cash, difference, net_operating_profit, status",
    )
    .eq("business_id", businessId)
    .order("closing_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    date: c.closing_date,
    salesTotal: Number(c.sales_total),
    collections: Number(c.collections),
    expectedCash: Number(c.expected_cash),
    countedCash: c.counted_cash === null ? null : Number(c.counted_cash),
    difference: c.difference === null ? null : Number(c.difference),
    netProfit: Number(c.net_operating_profit),
    status: c.status,
  }));
}

export interface MemberRow {
  id: string;
  userId: string;
  role: string;
  status: string;
}

export async function listMembers(businessId: string): Promise<MemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_members")
    .select("id, user_id, role, status")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    role: m.role,
    status: m.status,
  }));
}
