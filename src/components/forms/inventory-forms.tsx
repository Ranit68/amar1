"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/card";
import type { BillProduct } from "@/components/bills/types";
import type { ActionResult } from "@/app/(app)/inventory/actions";

const ADJUSTMENT_TYPES = [
  { value: "correction", label: "সংশোধন / Correction" },
  { value: "damaged", label: "নষ্ট / Damaged" },
  { value: "expired", label: "মেয়াদোত্তীর্ণ / Expired" },
  { value: "wastage", label: "নষ্ট-পাতি / Wastage" },
  { value: "other", label: "অন্যান্য / Other" },
];

const INITIAL: ActionResult = {};

export function AdjustmentForm({
  products,
  action,
}: {
  products: BillProduct[];
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [productId, setProductId] = useState("");
  const [direction, setDirection] = useState<"add" | "minus">("minus");
  const [type, setType] = useState("correction");

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="direction" value={direction} />
      <Field label="পণ্য / Product" htmlFor="adj_product_id">
        <Select id="adj_product_id" name="product_id" value={productId} onChange={(e) => setProductId(e.target.value)} required>
          <option value="">বাছুন…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameBn ?? p.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="ধরন / Type" htmlFor="adjustment_type">
        <Select id="adjustment_type" name="adjustment_type" value={type} onChange={(e) => setType(e.target.value)}>
          {ADJUSTMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="দিক / Direction" htmlFor="direction">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection("minus")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              direction === "minus" ? "border-red-300 bg-red-50 text-red-700" : "border-ink-200 text-ink-500"
            }`}
          >
            − কমান
          </button>
          <button
            type="button"
            onClick={() => setDirection("add")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              direction === "add" ? "border-green-300 bg-green-50 text-green-700" : "border-ink-200 text-ink-500"
            }`}
          >
            + যোগ
          </button>
        </div>
      </Field>

      <Field label="পরিমাণ / Qty" htmlFor="qty">
        <Input id="qty" name="qty" type="number" step="0.001" min="0.001" required />
      </Field>

      <div className={type === "correction" ? "" : "opacity-50"}>
        <Field
          label="কারণ / Reason"
          htmlFor="reason"
          hint={type === "correction" ? "নেতিবাচক সংশোধনে কারণ আবশ্যক" : undefined}
        >
          <Textarea id="reason" name="reason" disabled={type !== "correction"} />
        </Field>
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
          স্টক সামঞ্জস্য করুন
        </Button>
      </div>
    </form>
  );
}

interface CountLine {
  key: string;
  product_id: string;
  counted_qty: string;
}

export function StockCountForm({
  products,
  createAction,
  confirmAction,
}: {
  products: BillProduct[];
  createAction: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  confirmAction: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [createState, createFormAction, createPending] = useActionState(createAction, INITIAL);
  const [confirmState, confirmFormAction, confirmPending] = useActionState(confirmAction, INITIAL);
  const [lines, setLines] = useState<CountLine[]>([newLine()]);

  const alreadyCreated = Boolean(createState.countId);
  const countId = createState.countId ?? "";

  const itemsJson = JSON.stringify(
    lines
      .filter((l) => l.product_id && Number(l.counted_qty) >= 0)
      .map((l) => ({ product_id: l.product_id, counted_qty: Number(l.counted_qty) })),
  );

  function updateLine(key: string, patch: Partial<CountLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const activeState = alreadyCreated ? confirmState : createState;

  return (
    <div className="space-y-4">
      {!alreadyCreated ? (
        <form action={createFormAction} className="space-y-4">
          <input type="hidden" name="items" value={itemsJson} />
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="col-span-2 md:col-span-2">
                  <Select value={l.product_id} onChange={(e) => updateLine(l.key, { product_id: e.target.value })}>
                    <option value="">পণ্য বাছুন…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nameBn ?? p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="গণনা করা পরিমাণ"
                  value={l.counted_qty}
                  onChange={(e) => updateLine(l.key, { counted_qty: e.target.value })}
                />
                <div className="flex items-center justify-end">
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
          </div>
          <Button variant="outline" type="button" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="h-4 w-4" /> পণ্য যোগ
          </Button>
          <Field label="নোট / Notes" htmlFor="count_notes">
            <Input id="count_notes" name="notes" placeholder="ঐচ্ছিক" />
          </Field>
          <Button type="submit" disabled={createPending}>
            {createPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            গণনা শুরু করুন
          </Button>
        </form>
      ) : (
        <form action={confirmFormAction} className="space-y-4">
          <input type="hidden" name="count_id" value={countId} />
          <Field label="গণনা নিশ্চিত করুন" htmlFor="confirm_notes">
            <Input id="confirm_notes" name="notes" placeholder="গণনার নোট (ঐচ্ছিক)" />
          </Field>
          <Button type="submit" variant="primary" disabled={confirmPending}>
            {confirmPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            স্টক গণনা নিশ্চিত করুন
          </Button>
        </form>
      )}

      {activeState.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{activeState.error}</p>
      ) : null}
      {activeState.message ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{activeState.message}</p>
      ) : null}
    </div>
  );
}

function newLine(): CountLine {
  return { key: crypto.randomUUID(), product_id: "", counted_qty: "0" };
}