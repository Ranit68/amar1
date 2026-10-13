"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/card";
import type { ActionResult } from "@/app/(app)/settings/actions";

const INITIAL: ActionResult = {};

export function BusinessForm({
  name,
  locale,
  action,
}: {
  name: string;
  locale: string;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="ব্যবসার নাম / Business name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} maxLength={160} required />
      </Field>
      <Field label="ভাষা / Language" htmlFor="locale">
        <Select id="locale" name="locale" defaultValue={locale}>
          <option value="bn">বাংলা</option>
          <option value="en">English</option>
        </Select>
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{state.message}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        সংরক্ষণ করুন
      </Button>
    </form>
  );
}

const ROLES: { value: string; label: string }[] = [
  { value: "manager", label: "ম্যানেজার" },
  { value: "staff", label: "কর্মী" },
  { value: "owner", label: "মালিক" },
];

export function InviteForm({
  action,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="ইমেইল / Email" htmlFor="email" hint="যে ব্যবহারকারী ইতিমধ্যে নিবন্ধিত">
        <Input id="email" name="email" type="email" required />
      </Field>
      <Field label="ভূমিকা / Role" htmlFor="role">
        <Select id="role" name="role" defaultValue="staff">
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{state.message}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        আমন্ত্রণ পাঠান
      </Button>
    </form>
  );
}
