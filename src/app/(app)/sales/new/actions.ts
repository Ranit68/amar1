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

export async function postSalesAction(
  _prev: BillFormState,
  formData: FormData,
): Promise<BillFormState> {
  const session = await requireSession();
  if (!session.active.permissions.includes("sales.post")) {
    return { error: "অনুমতি নেই / Missing permission: sales.post" };
  }

  const hawkerId = String(formData.get("hawker_id") ?? "");
  if (!hawkerId) return { error: "হকার বাছুন / Select a hawker" };

  const items = parseArray<RawLine>(formData.get("items"));
  if (items.length === 0) {
    return { error: "কমপক্ষে একটি পণ্য যোগ করুন / Add at least one item" };
  }

  const received = parseArray<RawPayment>(formData.get("received")).filter(
    (p) => Number(p.amount) > 0,
  );

  const payload = {
    business_id: session.active.business.id,
    hawker_id: hawkerId,
    invoice_number: String(formData.get("invoice_number") ?? "").trim() || null,
    invoice_date: String(formData.get("invoice_date") ?? "").trim() || undefined,
    discount_total: Number(formData.get("discount_total") ?? 0) || 0,
    items: items.map((i) => ({
      product_id: i.product_id,
      qty: Number(i.qty),
      unit: i.unit,
      unit_price: Number(i.unit_price),
      discount: Number(i.discount ?? 0),
      tax: Number(i.tax ?? 0),
    })),
    received: received.map((p) => ({
      amount: Number(p.amount),
      method: p.method,
      cash_account_id: p.cash_account_id,
    })),
    idempotency_key: crypto.randomUUID(),
  } as unknown as Json;

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_sales_bill", { p_payload: payload });
  if (error) {
    return { error: "বিক্রয় সংরক্ষণ ব্যর্থ: " + error.message };
  }

  revalidatePath("/sales");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  redirect("/sales");
}
