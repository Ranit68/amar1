"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/card";
import type { ActionResult } from "@/app/(app)/products/actions";

const INITIAL: ActionResult = {};

export function HawkerForm({
  action,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="নাম / Name" htmlFor="name">
        <Input id="name" name="name" required />
      </Field>
      <Field label="ফোন / Phone" htmlFor="phone">
        <Input id="phone" name="phone" inputMode="tel" />
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 sm:col-span-2">
          সংরক্ষিত হয়েছে।
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          হকার সংরক্ষণ
        </Button>
      </div>
    </form>
  );
}
