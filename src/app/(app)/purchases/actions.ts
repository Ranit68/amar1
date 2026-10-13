"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

export interface ActionResult {
  error?: string;
  ok?: boolean;
  message?: string;
}

export async function voidPurchaseBillAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("purchases.post")) {
    return { error: "অনুমতি নেই / Missing permission: purchases.post" };
  }

  const billId = String(formData.get("bill_id") ?? "").trim();
  if (!billId) return { error: "বিল আইডি নেই / Missing bill id" };

  const reason = String(formData.get("reason") ?? "").trim() || "User requested void";

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_purchase_bill", {
    p_bill_id: billId,
    p_reason: reason,
  });
  if (error) return { error: "বাতিল ব্যর্থ: " + error.message };

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  revalidatePath("/reports");
  return { ok: true, message: "ক্রয় বিল বাতিল হয়েছে" };
}