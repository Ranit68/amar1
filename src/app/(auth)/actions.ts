"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
  message?: string;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "ইমেইল ও পাসওয়ার্ড দিন। / Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "লগইন ব্যর্থ: " + error.message };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    return { error: "সব ঘর পূরণ করুন। / All fields are required." };
  }
  if (password.length < 8) {
    return { error: "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে। / Min 8 characters." };
  }

  const headerList = await headers();
  const origin =
    process.env.APPLICATION_BASE_URL ??
    `${headerList.get("x-forwarded-proto") ?? "http"}://${headerList.get("host") ?? "localhost:3000"}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { error: "নিবন্ধন ব্যর্থ: " + error.message };
  }

  if (!data.session) {
    return {
      message:
        "যাচাইকরণের ইমেইল পাঠানো হয়েছে। লিংকে ক্লিক করে অ্যাকাউন্ট চালু করুন। / Verification email sent — please confirm your address.",
    };
  }

  redirect("/onboarding");
}
