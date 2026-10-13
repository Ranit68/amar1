"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { UNIT_SUGGESTIONS } from "@/lib/units";
import type {
  BillCashAccount,
  BillFormState,
  BillMode,
  BillPartner,
  BillProduct,
} from "@/components/bills/types";

interface LineItem {
  key: string;
  product_id: string;
  qty: string;
  unit: string;
  unit_price: string;
  discount: string;
  tax: string;
}

interface PaymentLine {
  key: string;
  cash_account_id: string;
  amount: string;
  method: string;
}

const INITIAL_STATE: BillFormState = {};

function newLine(product?: BillProduct, mode: BillMode = "sales"): LineItem {
  return {
    key: crypto.randomUUID(),
    product_id: product?.id ?? "",
    qty: "1",
    unit: product ? (mode === "sales" ? product.sellUnit : product.purchaseUnit) : "pcs",
    unit_price: "",
    discount: "0",
    tax: "0",
  };
}

export function BillForm({
  mode,
  partners,
  products,
  cashAccounts,
  action,
  today,
}: {
  mode: BillMode;
  partners: BillPartner[];
  products: BillProduct[];
  cashAccounts: BillCashAccount[];
  action: (prev: BillFormState, formData: FormData) => Promise<BillFormState>;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [lines, setLines] = useState<LineItem[]>([newLine(products[0], mode)]);
  const [discountTotal, setDiscountTotal] = useState("0");
  const [freight, setFreight] = useState("0");
  const [otherCosts, setOtherCosts] = useState("0");
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
  const [payments, setPayments] = useState<PaymentLine[]>([]);

  const isSales = mode === "sales";
  const partnerKey = isSales ? "hawker_id" : "supplier_id";
  const defaultAccount = cashAccounts[0]?.id ?? "";

  const lineTotal = useMemo(
    () =>
      lines.map((l) => {
        const gross = Number(l.qty || 0) * Number(l.unit_price || 0);
        return gross - Number(l.discount || 0) + Number(l.tax || 0);
      }),
    [lines],
  );

  const subtotal = lineTotal.reduce((a, b) => a + b, 0);
  const billTotal = Math.max(
    0,
    subtotal -
      Number(discountTotal || 0) +
      (isSales ? 0 : Number(freight || 0) + Number(otherCosts || 0)),
  );
  const receivedTotal = payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const outstanding = billTotal - receivedTotal;

  function updateLine(key: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onProductChange(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateLine(key, {
      product_id: productId,
      unit: product ? (isSales ? product.sellUnit : product.purchaseUnit) : "pcs",
    });
  }

  function updatePayment(key: string, patch: Partial<PaymentLine>) {
    setPayments((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  const itemsJson = JSON.stringify(
    lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({
        product_id: l.product_id,
        qty: Number(l.qty),
        unit: l.unit,
        unit_price: Number(l.unit_price || 0),
        discount: Number(l.discount || 0),
        tax: Number(l.tax || 0),
      })),
  );

  const paymentsJson = JSON.stringify(
    payments
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({
        amount: Number(p.amount),
        method: p.method,
        cash_account_id: p.method === "credit" ? null : p.cash_account_id || defaultAccount,
      })),
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name={partnerKey} value={partnerId} />
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name={isSales ? "received" : "payments"} value={paymentsJson} />
      <input type="hidden" name="discount_total" value={discountTotal} />
      {!isSales ? <input type="hidden" name="freight_cost" value={freight} /> : null}
      {!isSales ? <input type="hidden" name="other_costs" value={otherCosts} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{isSales ? "বিক্রয়ের বিবরণ" : "ক্রয়ের বিবরণ"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={isSales ? "হকার / ক্রেতা" : "সরবাহকারী"}>
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              {partners.length === 0 ? <option value="">কোনও নেই</option> : null}
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="বিল নম্বর / Invoice no.">
            <Input name="invoice_number" placeholder="ঐচ্ছিক" />
          </Field>
          <Field label="তারিখ / Date">
            <Input name="invoice_date" type="date" defaultValue={today} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>পণ্যের তালিকা</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, newLine(products[0], mode)])}
          >
            <Plus className="h-4 w-4" /> পণ্য যোগ
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l) => (
            <div
              key={l.key}
              className="grid grid-cols-1 gap-2 rounded-lg border border-ink-100 p-3 md:grid-cols-12"
            >
              <div className="md:col-span-4">
                <Select
                  value={l.product_id}
                  onChange={(e) => onProductChange(l.key, e.target.value)}
                >
                  <option value="">পণ্য বাছুন</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameBn ?? p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-2">
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="পরিমাণ"
                  value={l.qty}
                  onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Select
                  value={l.unit}
                  onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                >
                  {UNIT_SUGGESTIONS.map((u) => (
                    <option key={u.unit} value={u.unit}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={isSales ? "দর" : "ক্রয় দর"}
                  value={l.unit_price}
                  onChange={(e) => updateLine(l.key, { unit_price: e.target.value })}
                />
              </div>
              <div className="md:col-span-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="ছাড়"
                  value={l.discount}
                  onChange={(e) => updateLine(l.key, { discount: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-2 md:col-span-1">
                <span className="text-xs font-medium text-ink-600">
                  {formatMoney(lineTotal[lines.indexOf(l)] ?? 0)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) =>
                      prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev,
                    )
                  }
                  className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="সরান"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{isSales ? "অগ্রিম জমা / Received" : "পরিশোধ / Payments"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isSales ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="পরিবহন খরচ / Freight">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={freight}
                    onChange={(e) => setFreight(e.target.value)}
                  />
                </Field>
                <Field label="অন্যান্য খরচ / Other">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={otherCosts}
                    onChange={(e) => setOtherCosts(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {payments.map((p) => (
              <div key={p.key} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <Select
                  value={p.method}
                  onChange={(e) => updatePayment(p.key, { method: e.target.value })}
                >
                  <option value="cash">নগদ</option>
                  <option value="upi">UPI</option>
                  <option value="bank">ব্যাঙ্ক</option>
                  <option value="cheque">চেক</option>
                  <option value="credit">বাকি</option>
                </Select>
                <Select
                  value={p.cash_account_id || defaultAccount}
                  onChange={(e) => updatePayment(p.key, { cash_account_id: e.target.value })}
                  disabled={p.method === "credit"}
                >
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {formatMoney(a.balance)}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="টাকা"
                  value={p.amount}
                  onChange={(e) => updatePayment(p.key, { amount: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setPayments((prev) => prev.filter((x) => x.key !== p.key))}
                  className="rounded-lg border border-ink-200 p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="সরান"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPayments((prev) => [
                  ...prev,
                  {
                    key: crypto.randomUUID(),
                    cash_account_id: defaultAccount,
                    amount: "",
                    method: "cash",
                  },
                ])
              }
            >
              <Plus className="h-4 w-4" /> {isSales ? "জমা যোগ" : "পরিশোধ যোগ"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>সারসংক্ষেপ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="উপমোট" value={formatMoney(subtotal)} />
            <div className="flex items-center justify-between">
              <span className="text-ink-500">ছাড় / Discount</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={discountTotal}
                onChange={(e) => setDiscountTotal(e.target.value)}
                className="input-base w-28 text-right"
              />
            </div>
            {!isSales ? (
              <Row
                label="পরিবহন + অন্যান্য"
                value={formatMoney(Number(freight || 0) + Number(otherCosts || 0))}
              />
            ) : null}
            <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900">
              <span>মোট</span>
              <span>{formatMoney(billTotal)}</span>
            </div>
            <Row label={isSales ? "জমা" : "পরিশোধ"} value={formatMoney(receivedTotal)} />
            <Row
              label="বাকি"
              value={formatMoney(Math.max(0, outstanding))}
              emphasize
            />

            {state.error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {state.error}
              </p>
            ) : null}

            <Button type="submit" className="mt-2 w-full" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSales ? "বিক্রয় সংরক্ষণ" : "ক্রয় সংরক্ষণ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

function Row({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={emphasize ? "font-semibold text-amber-600" : "text-ink-800"}>
        {value}
      </span>
    </div>
  );
}
