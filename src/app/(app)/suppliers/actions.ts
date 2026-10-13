"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { ActionResult } from "@/app/(app)/products/actions";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createSupplierAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("suppliers.write")) {
    return { error: "অনুমতি নেই / Missing permission: suppliers.write" };
  }

  const name = str(formData, "name");
  if (!name) return { error: "নাম দিন / Name is required" };

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    business_id: session.active.business.id,
    name,
    phone: str(formData, "phone") || null,
    address: str(formData, "address") || null,
    gstin: str(formData, "gstin") || null,
    credit_days: Number(str(formData, "credit_days") || "0"),
  });

  if (error) return { error: "সংরক্ষণ ব্যর্থ: " + error.message };

  revalidatePath("/suppliers");
  return { ok: true };
}
