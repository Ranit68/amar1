"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/auth";

export interface OnboardingState {
  error?: string;
}

export async function createBusinessAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "ব্যবসার নাম দিন। / Business name is required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_business", { p_name: name });
  if (error || !data) {
    return { error: "তৈরি করা যায়নি: " + (error?.message ?? "unknown error") };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, data, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/dashboard");
}
