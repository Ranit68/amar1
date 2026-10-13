"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/card";

interface VoidState {
  error?: string;
  message?: string;
}

export function VoidBillButton({
  action,
  billId,
}: {
  action: (prev: VoidState, formData: FormData) => Promise<VoidState>;
  billId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <div className="flex items-center justify-end gap-2">
      {open ? (
        <form action={formAction} className="flex items-center gap-1.5">
          <input type="hidden" name="bill_id" value={billId} />
          <Input name="reason" placeholder="কারণ (ঐচ্ছিক)" className="h-8 w-40 text-xs" />
          <Button type="submit" size="sm" variant="danger" disabled={pending}>
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            নিশ্চিত
          </Button>
          <button
            type="button"
            className={buttonClasses("ghost", "sm")}
            onClick={() => setOpen(false)}
          >
            বাতিল
          </button>
        </form>
      ) : (
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          onClick={() => setOpen(true)}
        >
          বাতিল
        </button>
      )}
      {!open && state.error ? (
        <span className="text-xs text-red-600" title={state.error}>
          {state.error.length > 24 ? state.error.slice(0, 24) + "…" : state.error}
        </span>
      ) : null}
      {!open && state.message ? (
        <span className="text-xs text-brand-700">{state.message}</span>
      ) : null}
    </div>
  );
}