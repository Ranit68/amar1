"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

export interface ActionResult {
  error?: string;
  ok?: boolean;
  message?: string;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function confirmClosingAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("closing.post")) {
    return { error: "অনুমতি নেই / Missing permission: closing.post" };
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const date = str(formData, "closing_date") || today;
  const countedRaw = str(formData, "counted_cash");
  const counted = countedRaw === "" ? null : Number(countedRaw);
  if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
    return { error: "সঠিক গণনা করা নগদ দিন / Enter a valid counted cash amount" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_daily_closing", {
    p_business_id: session.active.business.id,
    p_closing_date: date,
    p_counted_cash: counted,
    p_notes: str(formData, "notes") || null,
  });

  if (error) return { error: "হিসাব মেলানো ব্যর্থ: " + error.message };

  revalidatePath("/closing");
  revalidatePath("/dashboard");

  const result = (data ?? {}) as {
    expected_cash?: number;
    counted_cash?: number | null;
    difference?: number | null;
  };
  const expected = Number(result.expected_cash ?? 0);
  const difference =
    result.difference === null || result.difference === undefined
      ? null
      : Number(result.difference);
  const message =
    difference === null
      ? `হিসাব সংরক্ষিত। প্রত্যাশিত নগদ ৳${expected.toFixed(2)}`
      : difference === 0
        ? "হিসাব মিলে গেছে। প্রত্যাশিত ও গণনা করা নগদ সমান।"
        : `পার্থক্য ৳${difference.toFixed(2)} (গণনা করা − প্রত্যাশিত)।`;

  return { ok: true, message };
}
