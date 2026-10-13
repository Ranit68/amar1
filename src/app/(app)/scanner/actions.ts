"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { Json } from "@/lib/database.types";

export interface ScannedBillResult {
  error?: string;
  ok?: boolean;
  message?: string;
  billType?: "sales" | "purchases";
}

interface RawLine {
  product_id: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount?: number;
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

export async function postScannedBillAction(
  _prev: ScannedBillResult,
  formData: FormData,
): Promise<ScannedBillResult> {
  const session = await requireSession();
  const mode = String(formData.get("mode") ?? "sales") === "purchases" ? "purchases" : "sales";
  const permission = mode === "purchases" ? "purchases.post" : "sales.post";
  if (!session.active.permissions.includes(permission)) {
    return { error: `অনুমতি নেই / Missing permission: ${permission}` };
  }

  const partnerId = String(formData.get("partner_id") ?? "").trim();
  if (!partnerId) {
    return { error: mode === "purchases" ? "সরবরাহকারী বাছুন" : "হকার বাছুন" };
  }

  const items = parseArray<RawLine>(formData.get("items")).filter(
    (i) => i.product_id && Number(i.qty) > 0,
  );
  if (items.length === 0) {
    return { error: "কমপক্ষে একটি পণ্য মিলান ও পরিমাণ দিন / Match at least one product" };
  }

  const base = {
    business_id: session.active.business.id,
    invoice_number: String(formData.get("invoice_number") ?? "").trim() || null,
    invoice_date: String(formData.get("invoice_date") ?? "").trim() || undefined,
    discount_total: 0,
    items: items.map((i) => ({
      product_id: i.product_id,
      qty: Number(i.qty),
      unit: i.unit,
      unit_price: Number(i.unit_price),
      discount: Number(i.discount ?? 0),
      tax: 0,
    })),
    idempotency_key: crypto.randomUUID(),
  };

  const supabase = await createClient();

  if (mode === "purchases") {
    const payload = {
      ...base,
      supplier_id: partnerId,
      freight_cost: 0,
      other_costs: 0,
      payments: [],
    } as unknown as Json;
    const { error } = await supabase.rpc("post_purchase_bill", { p_payload: payload });
    if (error) return { error: "ক্রয় সংরক্ষণ ব্যর্থ: " + error.message };
    revalidatePath("/purchases");
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    return { ok: true, billType: "purchases", message: "স্ক্যান থেকে ক্রয় বিল তৈরি হয়েছে।" };
  }

  const payload = {
    ...base,
    hawker_id: partnerId,
    received: [],
  } as unknown as Json;
  const { error } = await supabase.rpc("post_sales_bill", { p_payload: payload });
  if (error) return { error: "বিক্রয় সংরক্ষণ ব্যর্থ: " + error.message };
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  return { ok: true, billType: "sales", message: "স্ক্যান থেকে বিক্রয় বিল তৈরি হয়েছে।" };
}
