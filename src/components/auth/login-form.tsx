"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/card";
import { loginAction, type AuthFormState } from "@/app/(auth)/actions";

const INITIAL: AuthFormState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <h2 className="text-lg font-semibold text-ink-900">লগ ইন করুন</h2>
      <input type="hidden" name="next" value={next ?? "/dashboard"} />

      <Field label="ইমেইল / Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="পাসওয়ার্ড / Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        লগ ইন
      </Button>

      <p className="text-center text-sm text-ink-500">
        নতুন ব্যবহারকারী?{" "}
        <Link href="/signup" className="font-medium text-brand-700 hover:underline">
          নিবন্ধন করুন
        </Link>
      </p>
    </form>
  );
}
