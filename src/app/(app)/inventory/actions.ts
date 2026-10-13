"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { Json } from "@/lib/database.types";

export interface ActionResult {
  error?: string;
  ok?: boolean;
  message?: string;
  countId?: string;
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

export async function applyAdjustmentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("inventory.write")) {
    return { error: "অনুমতি নেই / Missing permission: inventory.write" };
  }

  const productId = String(formData.get("product_id") ?? "").trim();
  if (!productId) return { error: "পণ্য বাছুন / Select a product" };

  const direction = String(formData.get("direction") ?? "minus");
  const qty = Number(formData.get("qty"));
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: "সঠিক পরিমাণ দিন / Enter a valid quantity" };
  }
  const qtyChange = direction === "add" ? qty : -qty;

  const adjustmentType = String(formData.get("adjustment_type") ?? "correction");
  const reason = String(formData.get("reason") ?? "").trim();
  if (qtyChange < 0 && adjustmentType === "correction" && !reason) {
    return { error: "কমানোর কারণ লিখুন / A reason is required for negative corrections" };
  }

  const payload = {
    business_id: session.active.business.id,
    product_id: productId,
    qty_change: qtyChange,
    adjustment_type: adjustmentType,
    reason: reason || "no reason",
    apply_now: true,
  } as unknown as Json;

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_stock_adjustment", { p_payload: payload });
  if (error) return { error: "স্টক সামঞ্জস্য ব্যর্থ: " + error.message };

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `স্টক ${direction === "add" ? "যোগ" : "কমানো"} হয়েছে: ${qty}`,
  };
}

export async function createStockCountAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("inventory.write")) {
    return { error: "অনুমতি নেই / Missing permission: inventory.write" };
  }

  const items = parseArray<{ product_id: string; counted_qty: number }>(formData.get("items"));
  if (items.length === 0) {
    return { error: "কমপক্ষে একটি পণ্য দিন / Add at least one product" };
  }

  const payload = {
    business_id: session.active.business.id,
    notes: String(formData.get("notes") ?? "").trim() || null,
    items: items.map((i) => ({
      product_id: i.product_id,
      counted_qty: Number(i.counted_qty),
    })),
  } as unknown as Json;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_count", { p_payload: payload });
  if (error) return { error: "গণনা শুরু ব্যর্থ: " + error.message };

  const result = (data ?? {}) as { count_id?: string; item_count?: number };
  revalidatePath("/inventory");
  return {
    ok: true,
    countId: result.count_id,
    message: `গণনা তৈরি হয়েছে (${result.item_count ?? 0} পণ্য)। নিচে নিশ্চিত করুন।`,
  };
}

export async function confirmStockCountAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("inventory.write")) {
    return { error: "অনুমতি নেই / Missing permission: inventory.write" };
  }

  const countId = String(formData.get("count_id") ?? "").trim();
  if (!countId) return { error: "গণনা আইডি নেই / Missing count id" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_stock_count", {
    p_count_id: countId,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { error: "গণনা নিশ্চিত ব্যর্থ: " + error.message };

  revalidatePath("/inventory");
  revalidatePath("/dashboard");

  const result = (data ?? {}) as { adjusted_products?: number };
  return {
    ok: true,
    message: `গণনা নিশ্চিত হয়েছে — ${result.adjusted_products ?? 0}টি পণ্যের স্টক সামঞ্জস্য হয়েছে।`,
  };
}