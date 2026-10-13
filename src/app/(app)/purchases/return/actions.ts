"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { Json } from "@/lib/database.types";

export interface ReturnFormState {
  error?: string;
  ok?: boolean;
  message?: string;
}

interface RawLine {
  product_id: string;
  qty: number;
  unit: string;
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

export async function postPurchaseReturnAction(
  _prev: ReturnFormState,
  formData: FormData,
): Promise<ReturnFormState> {
  const session = await requireSession();
  if (!session.active.permissions.includes("purchases.post")) {
    return { error: "অনুমতি নেই / Missing permission: purchases.post" };
  }

  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!supplierId) return { error: "সরবরাহকারী বাছুন / Select a supplier" };

  const refundMode = String(formData.get("refund_mode") ?? "credit").trim();
  if (refundMode === "cash" && !String(formData.get("cash_account_id") ?? "").trim()) {
    return { error: "ক্যাশ/ব্যাঙ্ক অ্যাকাউন্ট বাছুন / Select an account" };
  }

  const items = parseArray<RawLine>(formData.get("items"));
  if (items.length === 0) {
    return { error: "কমপক্ষে একটি পণ্য যোগ করুন / Add at least one item" };
  }

  const payload = {
    business_id: session.active.business.id,
    supplier_id: supplierId,
    original_bill_id: String(formData.get("original_bill_id") ?? "").trim() || null,
    refund_mode: refundMode,
    return_date: String(formData.get("return_date") ?? "").trim() || undefined,
    cash_account_id: refundMode === "cash" ? String(formData.get("cash_account_id") ?? "").trim() : undefined,
    notes: String(formData.get("notes") ?? "").trim() || null,
    idempotency_key: crypto.randomUUID(),
    items: items.map((i) => ({
      product_id: i.product_id,
      qty: Number(i.qty),
      unit: i.unit,
    })),
  } as unknown as Json;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_purchase_return", { p_payload: payload });
  if (error) {
    return { error: "রিটার্ন সংরক্ষণ ব্যর্থ: " + error.message };
  }

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  revalidatePath("/reports");

  const result = (data ?? {}) as { total?: number };
  redirect(`/purchases?returned=${Number(result.total ?? 0).toFixed(2)}`);
}