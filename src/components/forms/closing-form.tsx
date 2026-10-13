"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/card";
import type { ActionResult } from "@/app/(app)/closing/actions";

const INITIAL: ActionResult = {};

export function ClosingForm({
  today,
  action,
}: {
  today: string;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="তারিখ / Date" htmlFor="closing_date">
        <Input id="closing_date" name="closing_date" type="date" defaultValue={today} required />
      </Field>
      <Field
        label="গণনা করা নগদ / Counted cash"
        htmlFor="counted_cash"
        hint="দৈনিক ড্রয়ারে থাকা নগদ টাকা"
      >
        <Input id="counted_cash" name="counted_cash" type="number" step="0.01" min="0" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="নোট / Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" />
        </Field>
      </div>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 sm:col-span-2">
          {state.message}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          দিনের হিসাব মেলান
        </Button>
      </div>
    </form>
  );
}
