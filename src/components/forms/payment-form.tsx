"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/card";
import type { ActionResult } from "@/app/(app)/payments/actions";
import type { OpenBillOption } from "@/lib/data/options";
import { todayISO } from "@/lib/format";

const INITIAL: ActionResult = {};

const METHODS = [
  { value: "cash", label: "নগদ / Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "ব্যাঙ্ক / Bank" },
  { value: "cheque", label: "চেক / Cheque" },
  { value: "credit", label: "বাকি / Credit" },
  { value: "other", label: "অন্যান্য / Other" },
];

interface PartyOption {
  id: string;
  name: string;
}

export function PaymentForm({
  action,
  hawkers,
  suppliers,
  accounts,
  customerBills,
  supplierBills,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  hawkers: PartyOption[];
  suppliers: PartyOption[];
  accounts: Array<{ id: string; name: string; kind: string }>;
  customerBills: OpenBillOption[];
  supplierBills: OpenBillOption[];
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState("");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  // User overrides per bill; missing entries fall back to default (checked, full outstanding).
  const [overrides, setOverrides] = useState<Record<string, { checked?: boolean; amount?: string }>>({});

  const parties = partyType === "customer" ? hawkers : suppliers;
  const bills = partyType === "customer" ? customerBills : supplierBills;

  const openBills = useMemo(
    () => bills.filter((b) => b.partnerId === partyId && b.outstanding > 0),
    [bills, partyId],
  );

  const alloc = Object.fromEntries(
    openBills.map((b) => [
      b.id,
      {
        checked: overrides[b.id]?.checked ?? true,
        amount: overrides[b.id]?.amount ?? String(b.outstanding),
      },
    ]),
  );

  const checkedAlloc = openBills
    .filter((b) => alloc[b.id]?.checked && Number(alloc[b.id]?.amount) > 0)
    .map((b) => ({ ref_id: b.id, amount: Number(alloc[b.id]!.amount) }));
  const allocSum = checkedAlloc.reduce((sum, a) => sum + a.amount, 0);

  function selectParty(id: string) {
    setPartyId(id);
    const total = bills
      .filter((b) => b.partnerId === id && b.outstanding > 0)
      .reduce((sum, b) => sum + b.outstanding, 0);
    setAmount(total > 0 ? String(total) : "");
    if (total > 0) syncAllocations(String(total), id);
  }

  // Keeps the bill allocations consistent with the collected amount: bills are
  // filled oldest-first up to `amount`, the remainder is left unallocated.
  function syncAllocations(amountStr: string, party = partyId) {
    const amt = Math.max(0, Number(amountStr || "0"));
    const relevant = bills.filter(
      (b) => b.partnerId === party && b.outstanding > 0,
    );
    const next: Record<string, { checked: boolean; amount: string }> = {};
    let remaining = amt;
    for (const b of relevant) {
      if (remaining <= 0) {
        next[b.id] = { checked: false, amount: "0" };
      } else {
        const take = Math.min(b.outstanding, remaining);
        next[b.id] = { checked: true, amount: String(take) };
        remaining -= take;
      }
    }
    setOverrides(next);
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="allocations" value={JSON.stringify(checkedAlloc)} />

      <Field label="লেনদেনের ধরন / Type" htmlFor="party_type">
        <Select
          id="party_type"
          name="party_type"
          value={partyType}
          onChange={(e) => {
            setPartyType(e.target.value as "customer" | "supplier");
            setPartyId("");
            setAmount("");
            setOverrides({});
            setAccountId("");
          }}
        >
          <option value="customer">হকার থেকে জমা / Customer collection</option>
          <option value="supplier">সরবরাহকারীকে পরিশোধ / Supplier payment</option>
        </Select>
      </Field>

      <Field label={partyType === "customer" ? "হকার / Hawker" : "সরবরাহকারী / Supplier"} htmlFor="party_id">
        <Select id="party_id" name="party_id" value={partyId} onChange={(e) => selectParty(e.target.value)} required>
          <option value="">বাছাই করুন…</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="টাকার অঙ্ক / Amount" htmlFor="amount" hint={allocSum > 0 ? `বিলে বরাদ্দ: ৳${allocSum.toFixed(2)}` : undefined}>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            syncAllocations(e.target.value);
          }}
          required
        />
      </Field>

      <Field label="পদ্ধতি / Method" htmlFor="method">
        <Select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      {method !== "credit" ? (
        <Field label="ক্যাশ/ব্যাঙ্ক অ্যাকাউন্ট / Account" htmlFor="cash_account_id">
          <Select
            id="cash_account_id"
            name="cash_account_id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">বাছাই করুন…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.kind === "cash" ? "নগদ" : a.kind === "bank" ? "ব্যাঙ্ক" : "UPI"})
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="তারিখ / Date" htmlFor="paid_at">
          <Input id="paid_at" name="paid_at" type="date" defaultValue={todayISO()} />
        </Field>
      )}

      <Field label="রেফারেন্স নং / Reference no." htmlFor="reference_no">
        <Input id="reference_no" name="reference_no" placeholder="চেক নং, UTR…" />
      </Field>

      <Field label="নোট / Notes" htmlFor="notes">
        <Input id="notes" name="notes" />
      </Field>

      {method !== "credit" ? (
        <Field label="তারিখ / Date" htmlFor="paid_at">
          <Input id="paid_at" name="paid_at" type="date" defaultValue={todayISO()} />
        </Field>
      ) : null}

      <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-ink-700">বাকি বিলে বরাদ্দ / Allocate to open bills</p>
          <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            {openBills.map((b) => {
              const row = alloc[b.id] ?? { checked: true, amount: String(b.outstanding) };
              return (
                <label key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [b.id]: { ...overrides[b.id], checked: e.target.checked },
                      }))
                    }
                  />
                  <span className="flex-1 text-ink-700">
                    {b.invoiceNumber ?? "বিল"} · <span className="text-ink-500">বাকি ৳{b.outstanding.toFixed(2)}</span>
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="h-8 w-28 text-right text-xs"
                    disabled={!row.checked}
                    value={row.amount}
                    onChange={(e) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [b.id]: { ...overrides[b.id], amount: e.target.value },
                      }))
                    }
                  />
                </label>
              );
            })}
          </div>
        </div>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 sm:col-span-2">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 sm:col-span-2">{state.message}</p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {partyType === "customer" ? "জমা সংরক্ষণ করুন" : "পরিশোধ সংরক্ষণ করুন"}
        </Button>
      </div>
    </form>
  );
}