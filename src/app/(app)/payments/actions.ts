"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { Json } from "@/lib/database.types";

export interface ActionResult {
  error?: string;
  ok?: boolean;
  message?: string;
}

interface RawAlloc {
  ref_id: string;
  amount: number;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function postPaymentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("payments.post")) {
    return { error: "অনুমতি নেই / Missing permission: payments.post" };
  }

  const partyType = str(formData, "party_type");
  if (partyType !== "customer" && partyType !== "supplier") {
    return { error: "লেনদেনের ধরন বাছুন / Select a transaction type" };
  }

  const partyId = str(formData, "party_id");
  if (!partyId) {
    return { error: "হকার বা সরবরাহকারী বাছুন / Select a party" };
  }

  const method = str(formData, "method") || "cash";
  const methodLabel = partyType === "customer" ? "জমা" : "পরিশোধ";
  if (method !== "credit") {
    const account = str(formData, "cash_account_id");
    if (!account) return { error: "ক্যাশ/ব্যাঙ্ক অ্যাকাউন্ট বাছুন / Select an account" };
  }

  const amount = Number(str(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "সঠিক টাকার অঙ্ক দিন / Enter a valid amount" };
  }

  const rawAllocs = str(formData, "allocations");
  let allocations: RawAlloc[] = [];
  try {
    const parsed = JSON.parse(rawAllocs);
    if (Array.isArray(parsed)) {
      allocations = parsed
        .filter((a) => a && a.ref_id && Number(a.amount) > 0)
        .map((a) => ({ ref_id: String(a.ref_id), amount: Number(a.amount) }));
    }
  } catch {
    allocations = [];
  }
  const allocSum = allocations.reduce((sum, a) => sum + a.amount, 0);
  if (allocSum > amount + 0.01) {
    return { error: "বিল বরাদ্দ জমার চেয়ে বেশি / Allocated more than the amount" };
  }

  const payload = {
    business_id: session.active.business.id,
    ...(partyType === "supplier"
      ? { supplier_id: partyId }
      : { hawker_id: partyId }),
    amount,
    method,
    cash_account_id: method === "credit" ? null : str(formData, "cash_account_id"),
    reference_no: str(formData, "reference_no") || null,
    notes: str(formData, "notes") || null,
    paid_at: str(formData, "paid_at") || undefined,
    idempotency_key: crypto.randomUUID(),
    allocations,
  } as unknown as Json;

  const supabase = await createClient();
  const rpc = partyType === "supplier" ? "post_supplier_payment" : "post_customer_payment";
  const { data, error } = await supabase.rpc(rpc, { p_payload: payload });
  if (error) {
    return { error: `${methodLabel} ব্যর্থ: ${error.message}` };
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/sales");
  revalidatePath("/purchases");
  revalidatePath("/reports");

  const result = (data ?? {}) as { amount?: number; allocated?: number };
  const amountText = Number(result.amount ?? amount).toFixed(2);
  const allocatedText = Number(result.allocated ?? 0).toFixed(2);
  return {
    ok: true,
    message: `${methodLabel} সংরক্ষিত: ৳${amountText} (বিলে বরাদ্দ ৳${allocatedText})`,
  };
}