"use client";

import { useActionState, useState, type FormEvent } from "react";
import { Loader2, Upload, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/card";
import type { ScannedBillResult } from "@/app/(app)/scanner/actions";

interface OcrLine {
  raw_name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
}

interface OcrResult {
  status: string;
  provider?: string;
  message?: string;
  text?: string;
  lines?: OcrLine[];
}

export interface ProductLite {
  id: string;
  name: string;
  nameBn: string | null;
  baseUnit: string;
  sellUnit: string;
  purchaseUnit: string;
}

export interface PartnerLite {
  id: string;
  name: string;
}

interface Row {
  key: string;
  rawName: string;
  productId: string;
  unit: string;
  qty: string;
  unitPrice: string;
}

const INITIAL: ScannedBillResult = {};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function unitsFor(p: ProductLite, mode: "sales" | "purchases"): string[] {
  const all = [p.baseUnit, mode === "purchases" ? p.purchaseUnit : p.sellUnit];
  return Array.from(new Set(all.filter(Boolean)));
}

function defaultUnit(p: ProductLite, mode: "sales" | "purchases"): string {
  return mode === "purchases" ? p.purchaseUnit || p.baseUnit : p.sellUnit || p.baseUnit;
}

function matchProduct(rawName: string, products: ProductLite[]): ProductLite | null {
  const target = normalize(rawName);
  if (!target) return null;
  let best: ProductLite | null = null;
  let bestScore = 0;
  for (const p of products) {
    const names = [p.name, p.nameBn ?? ""].map(normalize).filter(Boolean);
    for (const n of names) {
      if (!n) continue;
      let score = 0;
      if (target === n) score = 100;
      else if (target.includes(n) || n.includes(target)) score = 60;
      else {
        const tokens = new Set(n.split(" "));
        const hits = target.split(" ").filter((t) => tokens.has(t)).length;
        score = hits * 20;
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return bestScore >= 20 ? best : null;
}

export function ScanUploader({
  products,
  hawkers,
  suppliers,
  action,
}: {
  products: ProductLite[];
  hawkers: PartnerLite[];
  suppliers: PartnerLite[];
  action: (prev: ScannedBillResult, formData: FormData) => Promise<ScannedBillResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"sales" | "purchases">("sales");
  const [state, formAction, pending] = useActionState(action, INITIAL);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("file");
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;

    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", input.files[0]);
      const res = await fetch("/api/ocr", { method: "POST", body });
      const json = (await res.json()) as OcrResult;
      setResult(json);
      if (json.status === "ok" && json.lines) {
        setRows(
          json.lines.map((l, i) => {
            const matched = matchProduct(l.raw_name, products);
            return {
              key: `${i}-${l.raw_name}`,
              rawName: l.raw_name,
              productId: matched?.id ?? "",
              unit: matched ? defaultUnit(matched, mode) : "",
              qty: l.qty !== null ? String(l.qty) : "1",
              unitPrice: l.unit_price !== null ? String(l.unit_price) : "",
            };
          }),
        );
      }
    } catch {
      setResult({ status: "error", message: "সার্ভারে পাঠানো যায়নি।" });
    } finally {
      setBusy(false);
    }
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onPickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    updateRow(key, {
      productId,
      unit: p ? defaultUnit(p, mode) : "",
    });
  }

  function onModeChange(next: "sales" | "purchases") {
    setMode(next);
    setRows((prev) =>
      prev.map((r) => {
        const p = products.find((x) => x.id === r.productId);
        return p ? { ...r, unit: defaultUnit(p, next) } : r;
      }),
    );
  }

  const items = rows
    .filter((r) => r.productId && Number(r.qty) > 0)
    .map((r) => ({
      product_id: r.productId,
      qty: Number(r.qty),
      unit: r.unit,
      unit_price: Number(r.unitPrice || 0),
    }));
  const itemsJson = JSON.stringify(items);
  const grandTotal = items.reduce((acc, i) => acc + i.qty * i.unit_price, 0);
  const partners = mode === "purchases" ? suppliers : hawkers;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>বিলের ছবি তুলুন / আপলোড করুন</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <input
                type="file"
                name="file"
                accept="image/*"
                capture="environment"
                className="block w-full cursor-pointer rounded-lg border border-dashed border-ink-300 bg-ink-50 px-3 py-6 text-sm text-ink-500 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-white"
              />
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                স্ক্যান করুন
              </Button>
            </form>
            <p className="mt-3 text-xs text-ink-400">
              বাংলা + ইংরেজি OCR (tesseract.js)। সঠিক ফলাফলের জন্য ভালো আলোয় ছবি তুলুন।
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OCR ফলাফল</CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-ink-400">এখনও কিছু স্ক্যান করা হয়নি।</p>
            ) : result.status !== "ok" ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {result.message ?? `অবস্থা: ${result.status}`}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                  {result.provider} · {result.lines?.length ?? 0} লাইন শনাক্ত · ডিফল্ট{" "}
                  {rows.filter((r) => r.productId).length}টি মিলেছে
                </p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
                  {result.text || "(খালি)"}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>যাচাই করুন ও বিল তৈরি করুন</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="mode" value={mode} />
              <input type="hidden" name="items" value={itemsJson} />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="ধরন / Type" htmlFor="scan_mode">
                  <Select
                    id="scan_mode"
                    value={mode}
                    onChange={(e) => onModeChange(e.target.value as "sales" | "purchases")}
                  >
                    <option value="sales">বিক্রয় / Sales</option>
                    <option value="purchases">ক্রয় / Purchase</option>
                  </Select>
                </Field>
                <Field label={mode === "purchases" ? "সরবরাহকারী" : "হকার"} htmlFor="partner_id">
                  <Select id="partner_id" name="partner_id" defaultValue="">
                    <option value="">— বাছুন —</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="তারিখ / Date" htmlFor="invoice_date">
                  <Input
                    id="invoice_date"
                    name="invoice_date"
                    type="date"
                    defaultValue={new Date().toLocaleDateString("en-CA")}
                  />
                </Field>
                <Field label="চালান নম্বর / Invoice no." htmlFor="invoice_number">
                  <Input id="invoice_number" name="invoice_number" placeholder="ঐচ্ছিক" />
                </Field>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
                      <th className="px-2 py-2">OCR নাম</th>
                      <th className="px-2 py-2">পণ্য</th>
                      <th className="px-2 py-2">একক</th>
                      <th className="px-2 py-2 text-right">পরিমাণ</th>
                      <th className="px-2 py-2 text-right">দর</th>
                      <th className="px-2 py-2 text-right">মোট</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const p = products.find((x) => x.id === r.productId);
                      const lineTotal = p ? Number(r.qty || 0) * Number(r.unitPrice || 0) : 0;
                      return (
                        <tr key={r.key} className="border-b border-ink-50">
                          <td className="px-2 py-2 text-xs text-ink-500">
                            <span className={p ? "" : "text-red-500"}>{r.rawName}</span>
                          </td>
                          <td className="px-2 py-2">
                            <Select
                              className="min-w-40"
                              value={r.productId}
                              onChange={(e) => onPickProduct(r.key, e.target.value)}
                            >
                              <option value="">— মিলাননি —</option>
                              {products.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.nameBn ?? opt.name}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-2 py-2">
                            {p ? (
                              <Select
                                className="min-w-20"
                                value={r.unit}
                                onChange={(e) => updateRow(r.key, { unit: e.target.value })}
                              >
                                {unitsFor(p, mode).map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <span className="text-xs text-ink-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              className="w-20 text-right"
                              type="number"
                              step="0.001"
                              min="0"
                              value={r.qty}
                              onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              className="w-24 text-right"
                              type="number"
                              step="0.01"
                              min="0"
                              value={r.unitPrice}
                              onChange={(e) => updateRow(r.key, { unitPrice: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2 text-right font-medium text-ink-800">
                            {lineTotal.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="px-2 py-2 text-right text-sm text-ink-500">
                        সর্বমোট
                      </td>
                      <td className="px-2 py-2 text-right text-base font-semibold text-ink-900">
                        {grandTotal.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {state.error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
              ) : null}
              {state.message ? (
                <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
                  {state.message}{" "}
                  <a
                    className="underline"
                    href={state.billType === "purchases" ? "/purchases" : "/sales"}
                  >
                    তালিকা দেখুন
                  </a>
                </p>
              ) : null}

              <Button type="submit" disabled={pending || items.length === 0}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                বিল তৈরি করুন
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
