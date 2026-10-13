"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, Input } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { BarcodeScanner } from "@/components/scanner/barcode-scanner";
import { formatMoney, formatQty } from "@/lib/format";
import type { ProductRow } from "@/lib/data/lists";

export function ProductSearch({ products }: { products: ProductRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) =>
      [p.name, p.nameBn ?? "", p.sku, p.barcode ?? ""].some((value) =>
        value.toLowerCase().includes(term),
      ),
    );
  }, [products, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="নাম, SKU বা বারকোড দিয়ে খুঁজুন..."
            className="pl-9"
            aria-label="পণ্য খুঁজুন"
          />
        </div>
        <BarcodeScanner label="বারকোড স্ক্যান" onDetected={setQuery} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="কোনও পণ্য পাওয়া যায়নি"
          description={
            query ? `"${query}" এর সাথে মিলে এমন পণ্য নেই।` : "এখনও কোনও পণ্য যোগ করা হয়নি।"
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>পণ্য</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">ক্রয় দর</Th>
                  <Th className="text-right">বিক্রয় দর</Th>
                  <Th className="text-right">স্টক</Th>
                  <Th>অবস্থা</Th>
                </Tr>
              </THead>
              <TBody>
                {filtered.map((p) => {
                  const low = p.stockQty <= p.minStock;
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <p className="font-medium text-ink-900">{p.nameBn ?? p.name}</p>
                        <p className="text-xs text-ink-400">
                          {p.nameBn ? `${p.name} · ` : ""}
                          {p.categoryName ?? "বিভাগ নেই"}
                        </p>
                      </Td>
                      <Td className="text-ink-500">{p.sku}</Td>
                      <Td className="text-right text-ink-600">
                        {p.purchasePrice === null ? "—" : formatMoney(p.purchasePrice)}
                      </Td>
                      <Td className="text-right font-medium text-ink-900">
                        {p.salePrice === null ? "—" : formatMoney(p.salePrice)}
                      </Td>
                      <Td className={`text-right font-medium ${low ? "text-amber-600" : "text-ink-700"}`}>
                        {formatQty(p.stockQty)} {p.baseUnit}
                      </Td>
                      <Td>
                        {!p.isActive ? (
                          <Badge tone="neutral">নিষ্ক্রিয়</Badge>
                        ) : low ? (
                          <Badge tone="amber">কম স্টক</Badge>
                        ) : (
                          <Badge tone="green">স্টক আছে</Badge>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
