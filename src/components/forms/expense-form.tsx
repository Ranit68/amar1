"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/card";
import type { ActionResult } from "@/app/(app)/expenses/actions";

const INITIAL: ActionResult = {};

const KINDS: { value: string; label: string }[] = [
  { value: "operating", label: "পরিচালন খরচ" },
  { value: "owner_drawings", label: "মালিকের উত্তোলন" },
  { value: "loan_principal", label: "ঋণ পরিশোধ (আসল)" },
  { value: "loan_interest", label: "ঋণের সুদ" },
  { value: "capital", label: "মূলধন" },
  { value: "tax", label: "কর" },
  { value: "other", label: "অন্যান্য" },
];

const METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "নগদ" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "ব্যাঙ্ক" },
  { value: "cheque", label: "চেক" },
  { value: "credit", label: "বাকি (অপরিশোধিত)" },
  { value: "other", label: "অন্যান্য" },
];

export function ExpenseForm({
  accounts,
  today,
  action,
}: {
  accounts: { id: string; name: string }[];
  today: string;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="টাকার পরিমাণ / Amount" htmlFor="amount">
        <Input id="amount" name="amount" type="number" step="0.01" min="0" required />
      </Field>
      <Field label="তারিখ / Date" htmlFor="expense_date">
        <Input id="expense_date" name="expense_date" type="date" defaultValue={today} />
      </Field>
      <Field label="খাত / Category" htmlFor="category" hint="যেমন: ভাড়া, বিদ্যুৎ, পরিবহন">
        <Input id="category" name="category" defaultValue="Miscellaneous" />
      </Field>
      <Field label="ধরন / Kind" htmlFor="kind">
        <Select id="kind" name="kind" defaultValue="operating">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="মাধ্যম / Method" htmlFor="payment_method">
        <Select id="payment_method" name="payment_method" defaultValue="cash">
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="ক্যাশ/ব্যাঙ্ক অ্যাকাউন্ট" htmlFor="cash_account_id">
        <Select id="cash_account_id" name="cash_account_id" defaultValue="">
          <option value="">— বাছুন —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="বিবরণ / Description" htmlFor="description">
          <Textarea id="description" name="description" />
        </Field>
      </div>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 sm:col-span-2">
          খরচ সংরক্ষিত হয়েছে।
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          খরচ যোগ করুন
        </Button>
      </div>
    </form>
  );
}
