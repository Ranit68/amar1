"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/card";
import { createBusinessAction, type OnboardingState } from "@/app/onboarding/actions";

const INITIAL: OnboardingState = {};

export function CreateBusinessForm() {
  const [state, formAction, pending] = useActionState(createBusinessAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="ব্যবসার নাম / Business name"
        htmlFor="name"
        hint="যেমন: শ্রী গণেশ ট্রেডার্স / e.g. Sri Ganesh Traders"
      >
        <Input id="name" name="name" autoFocus required />
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        দোকান শুরু করুন
      </Button>
    </form>
  );
}
