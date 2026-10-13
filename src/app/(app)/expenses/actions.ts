"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function recordExpenseAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("expenses.post")) {
    return { error: "অনুমতি নেই / Missing permission: expenses.post" };
  }

  const amount = Number(str(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "সঠিক টাকার পরিমাণ দিন / Enter a valid amount" };
  }

  const method = str(formData, "payment_method") || "cash";
  const accountId = str(formData, "cash_account_id");
  if (method !== "credit" && !accountId) {
    return { error: "ক্যাশ/ব্যাঙ্ক অ্যাকাউন্ট বাছুন / Select a cash or bank account" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_expense", {
    p_payload: {
      business_id: session.active.business.id,
      amount,
      expense_date: str(formData, "expense_date") || undefined,
      category: str(formData, "category") || "Miscellaneous",
      kind: str(formData, "kind") || "operating",
      description: str(formData, "description") || null,
      payment_method: method,
      cash_account_id: method === "credit" ? null : accountId || undefined,
      is_paid: method !== "credit",
      idempotency_key: crypto.randomUUID(),
    },
  });

  if (error) return { error: "সংরক্ষণ ব্যর্থ: " + error.message };

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  return { ok: true };
}
