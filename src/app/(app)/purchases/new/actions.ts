"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import type { BillFormState } from "@/components/bills/types";

interface RawLine {
  product_id: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount?: number;
  tax?: number;
}

interface RawPayment {
  amount: number;
  method: string;
  cash_account_id: string | null;
}

function parseArray<T>(value: FormDataEntryValue | null): T[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function postPurchaseAction(
  _prev: BillFormState,
  formData: FormData,
): Promise<BillFormState> {
  const session = await requireSession();
  if (!session.active.permissions.includes("purchases.post")) {
    return { error: "অনুমতি নেই / Missing permission: purchases.post" };
  }

  const supplierId = String(formData.get("supplier_id") ?? "");
  if (!supplierId) return { error: "সরবরাহকারী বাছুন / Select a supplier" };

  const items = parseArray<RawLine>(formData.get("items"));
  if (items.length === 0) {
    return { error: "কমপক্ষে একটি পণ্য যোগ করুন / Add at least one item" };
  }

  const payments = parseArray<RawPayment>(formData.get("payments")).filter(
    (p) => Number(p.amount) > 0,
  );

  const payload = {
    business_id: session.active.business.id,
    supplier_id: supplierId,
    invoice_number: String(formData.get("invoice_number") ?? "").trim() || null,
    invoice_date: String(formData.get("invoice_date") ?? "").trim() || undefined,
    discount_total: Number(formData.get("discount_total") ?? 0) || 0,
    freight_cost: Number(formData.get("freight_cost") ?? 0) || 0,
    other_costs: Number(formData.get("other_costs") ?? 0) || 0,
    items: items.map((i) => ({
      product_id: i.product_id,
      qty: Number(i.qty),
      unit: i.unit,
      unit_price: Number(i.unit_price),
      discount: Number(i.discount ?? 0),
      tax: Number(i.tax ?? 0),
    })),
    payments: payments.map((p) => ({
      amount: Number(p.amount),
      method: p.method,
      cash_account_id: p.cash_account_id,
    })),
    idempotency_key: crypto.randomUUID(),
  } as unknown as Json;

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_purchase_bill", { p_payload: payload });
  if (error) {
    return { error: "ক্রয় সংরক্ষণ ব্যর্থ: " + error.message };
  }

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  redirect("/purchases");
}
