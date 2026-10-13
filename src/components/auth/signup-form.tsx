"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/card";
import { signupAction, type AuthFormState } from "@/app/(auth)/actions";

const INITIAL: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <h2 className="text-lg font-semibold text-ink-900">নতুন অ্যাকাউন্ট</h2>

      <Field label="নাম / Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>

      <Field label="ইমেইল / Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field
        label="পাসওয়ার্ড / Password"
        htmlFor="password"
        hint="কমপক্ষে ৮ অক্ষর / At least 8 characters"
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        নিবন্ধন করুন
      </Button>

      <p className="text-center text-sm text-ink-500">
        আগে থেকেই অ্যাকাউন্ট আছে?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          লগ ইন
        </Link>
      </p>
    </form>
  );
}
