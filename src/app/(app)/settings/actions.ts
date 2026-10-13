"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

export interface ActionResult {
  error?: string;
  ok?: boolean;
  message?: string;
}

export async function updateBusinessAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("settings.manage")) {
    return { error: "অনুমতি নেই / Missing permission: settings.manage" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const locale = String(formData.get("locale") ?? "").trim();
  if (!name) return { error: "ব্যবসার নাম দিন / Enter a business name" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_business", {
    p_business_id: session.active.business.id,
    p_name: name,
    p_locale: locale || "bn",
  });
  if (error) return { error: "আপডেট ব্যর্থ: " + error.message };

  revalidatePath("/settings");
  return { ok: true, message: "ব্যবসার তথ্য আপডেট হয়েছে।" };
}

const VALID_ROLES = ["owner", "manager", "staff"];

export async function inviteMemberAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("users.manage")) {
    return { error: "অনুমতি নেই / Missing permission: users.manage" };
  }

  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "staff").trim();
  if (!email) return { error: "ইমেইল দিন / Enter an email" };
  if (!VALID_ROLES.includes(role)) {
    return { error: "ভূমিকা সঠিক নয় / Invalid role" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", {
    p_business_id: session.active.business.id,
    p_email: email,
    p_role: role,
  });
  if (error) return { error: "আমন্ত্রণ ব্যর্থ: " + error.message };

  revalidatePath("/settings");
  return { ok: true, message: `আমন্ত্রণ পাঠানো হয়েছে: ${email}` };
}
