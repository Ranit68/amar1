"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { UNIT_SUGGESTIONS } from "@/lib/units";
import type { BillCashAccount, BillPartner, BillProduct } from "@/components/bills/types";
import type { ReturnFormState } from "@/app/(app)/sales/return/actions";
import type { ApprovedBillOption } from "@/lib/data/options";

interface ReturnLine {
  key: string;
  product_id: string;
  qty: string;
  unit: string;
  unit_price: string;
  discount: string;
}

const INITIAL: ReturnFormState = {};

export function ReturnForm({
  mode,
  partners,
  products,
  cashAccounts,
  approvedBills,
  initialBillId = "",
  today,
  action,
}: {
  mode: "sales" | "purchases";
  partners: BillPartner[];
  products: BillProduct[];
  cashAccounts: BillCashAccount[];
  approvedBills: ApprovedBillOption[];
  initialBillId?: string;
  today: string;
  action: (prev: ReturnFormState, formData: FormData) => Promise<ReturnFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
  const [billId, setBillId] = useState(initialBillId);
  const [refundMode, setRefundMode] = useState<"credit" | "cash">("credit");
  const [lines, setLines] = useState<ReturnLine[]>([newLine()]);

  const isSales = mode === "sales";
  const partnerKey = isSales ? "hawker_id" : "supplier_id";

  // Bill must belong to the selected partner to be meaningful.
  const billOptions = isSales
    ? approvedBills.filter((b) => b.partnerId === partnerId)
    : approvedBills.filter((b) => b.partnerId === partnerId);

  const totals = useMemo(
    () =>
      lines.map((l) => {
        if (isSales) {
          const gross = Number(l.qty || 0) * Number(l.unit_price || 0);
          return Math.max(0, gross - Number(l.discount || 0));
        }
        const product = products.find((p) => p.id === l.product_id);
        const factor = product?.unitFactors?.[l.unit];
        if (!product || factor == null || !Number(l.qty)) return null;
        return Number(l.qty) * factor * (product.avgCost ?? 0);
      }),
    [lines, isSales, products],
  );
  const hasUnknownTotal = totals.some((t) => t === null);
  const grandTotal = totals.reduce<number>((a, b) => a + (b ?? 0), 0);

  function updateLine(key: string, patch: Partial<ReturnLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onProductChange(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    updateLine(key, {
      product_id: productId,
      unit: product ? (isSales ? product.sellUnit : product.purchaseUnit) : "pcs",
    });
  }

  const itemsJson = JSON.stringify(
    lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) =>
        isSales
          ? {
              product_id: l.product_id,
              qty: Number(l.qty),
              unit: l.unit,
              unit_price: l.unit_price ? Number(l.unit_price) : undefined,
              discount: l.discount ? Number(l.discount) : undefined,
            }
          : {
              product_id: l.product_id,
              qty: Number(l.qty),
              unit: l.unit,
            },
      ),
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name={partnerKey} value={partnerId} />
      <input type="hidden" name="items" value={itemsJson} />

      <Card>
        <CardHeader>
          <CardTitle>{isSales ? "বিক্রয় রিটার্নের বিবরণ" : "ক্রয় রিটার্নের বিবরণ"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={isSales ? "হকার / ক্রেতা" : "সরবরাহকারী"}>
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              {partners.length === 0 ? <option value="">কোনও নেই</option> : null}
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="মূল বিল / Original bill" hint="ঐচ্ছিক">
            <Select value={billId} onChange={(e) => setBillId(e.target.value)}>
              <option value="">বিল ছাড়া (নতুন রিটার্ন)</option>
              {billOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.invoiceNumber ?? "বিল"} {b.invoiceDate ? `· ${b.invoiceDate}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="তারিখ / Date">
            <Input name="return_date" type="date" defaultValue={today} />
          </Field>

          <Field label="ফেরতের ধরন / Refund mode">
            <Select
              name="refund_mode"
              value={refundMode}
              onChange={(e) => setRefundMode(e.target.value as "credit" | "cash")}
            >
              <option value="credit">{isSales ? "বাকি মেটাও / Reduce credit" : "বাকি মেটাও / Reduce due"}</option>
              <option value="cash">নগদ ফেরত / Cash refund</option>
            </Select>
          </Field>
          {refundMode === "cash" ? (
            <Field label="ক্যাশ/ব্যাঙ্ক অ্যাকাউন্ট / Account">
              <Select name="cash_account_id" defaultValue="" required>
                <option value="">বাছাই করুন…</option>
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {formatMoney(a.balance)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="নোট / Notes">
            <Input name="notes" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>রিটার্নের পণ্য</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="h-4 w-4" /> পণ্য যোগ
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg border border-ink-100 p-3 md:grid-cols-12">
              <div className="col-span-2 md:col-span-4">
                <Select value={l.product_id} onChange={(e) => onProductChange(l.key, e.target.value)}>
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
                <Select value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })}>
                  {UNIT_SUGGESTIONS.map((u) => (
                    <option key={u.unit} value={u.unit}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </div>
              {isSales ? (
                <>
                  <div className="md:col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="ফেরত দর"
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
                </>
              ) : null}
              <div className="flex items-center justify-between md:col-span-1">
                <span className="text-xs font-medium text-ink-600">
                  {formatMoney(totals[lines.indexOf(l)] ?? 0)}
                </span>
                <button
                  type="button"
                  onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev))}
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

      <Card>
        <CardHeader>
          <CardTitle>সারসংক্ষেপ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900">
            <span>{isSales ? "মোট রিটার্ন" : "আনুমানিক মোট রিটার্ন"}</span>
            <span>{formatMoney(grandTotal)}</span>
          </div>
          {!isSales ? (
            <p className="text-xs text-ink-400">
              বর্তমান গড় ক্রয়মূল্য অনুযায়ী আনুমানিক — সংরক্ষণের সময় চূড়ান্ত হিসাব হবে।
            </p>
          ) : null}
          {hasUnknownTotal ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              কিছু পণ্যের একক রূপান্তর অজানা, তাই সেই লাইনগুলো হিসাবে ধরা হয়নি।
            </p>
          ) : null}
          <p className="text-xs text-ink-400">
            {refundMode === "credit"
              ? isSales
                ? "হকারের বাকি থেকে কেটে নেওয়া হবে।"
                : "সরবরাহকারীর বাকি থেকে কেটে নেওয়া হবে।"
              : "নগদ/ব্যাঙ্ক থেকে ফেরত দেওয়া হবে।"}
          </p>

          {state.error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
          ) : null}

          <Button type="submit" className="mt-2 w-full" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSales ? "রিটার্ন সংরক্ষণ" : "রিটার্ন সংরক্ষণ"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}

function newLine(): ReturnLine {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    qty: "1",
    unit: "pcs",
    unit_price: "",
    discount: "",
  };
}