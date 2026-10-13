"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/card";
import { BarcodeScanner } from "@/components/scanner/barcode-scanner";
import { UNIT_SUGGESTIONS } from "@/lib/units";
import type { ActionResult } from "@/app/(app)/products/actions";

const INITIAL: ActionResult = {};

export function ProductForm({
  categories,
  action,
}: {
  categories: { id: string; name: string }[];
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [barcode, setBarcode] = useState("");

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="নাম (বাংলা) / Name (Bengali)" htmlFor="name">
        <Input id="name" name="name" required />
      </Field>
      <Field label="English name" htmlFor="name_bn">
        <Input id="name_bn" name="name_bn" />
      </Field>
      <Field label="SKU / কোড" htmlFor="sku" hint="খালি রাখলে স্বয়ংক্রিয়">
        <Input id="sku" name="sku" />
      </Field>
      <Field label="বিভাগ / Category" htmlFor="category_id">
        <Select id="category_id" name="category_id" defaultValue="">
          <option value="">— বাছুন —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="মূল একক / Base unit" htmlFor="base_unit">
        <Select id="base_unit" name="base_unit" defaultValue="pcs">
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u.unit} value={u.unit}>
              {u.label} ({u.unit})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="ন্যূনতম স্টক / Min stock" htmlFor="min_stock">
        <Input id="min_stock" name="min_stock" type="number" step="0.001" min="0" defaultValue="0" />
      </Field>

      <Field label="ক্রয় দর / Buying price" htmlFor="purchase_price" hint="প্রতি একক ক্রয়মূল্য">
        <Input
          id="purchase_price"
          name="purchase_price"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
        />
      </Field>
      <Field label="বিক্রয় দর / Selling price" htmlFor="sale_price" hint="প্রতি একক বিক্রয়মূল্য">
        <Input
          id="sale_price"
          name="sale_price"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="বারকোড / Barcode" htmlFor="barcode" hint="স্ক্যান করুন বা হাতে লিখুন (ঐচ্ছিক)">
          <div className="flex items-center gap-2">
            <Input
              id="barcode"
              name="barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="বারকোড নম্বর"
            />
            <BarcodeScanner onDetected={setBarcode} />
          </div>
        </Field>
      </div>
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
          পণ্য সংরক্ষণ
        </Button>
      </div>
    </form>
  );
}
