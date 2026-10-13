import { requireSession } from "@/lib/auth";
import { listInventory } from "@/lib/data/lists";
import { listActiveProducts } from "@/lib/data/options";
import { formatMoney, formatQty } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AdjustmentForm, StockCountForm } from "@/components/forms/inventory-forms";
import {
  applyAdjustmentAction,
  confirmStockCountAction,
  createStockCountAction,
} from "./actions";

export default async function InventoryPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const [inventory, products] = await Promise.all([
    listInventory(businessId),
    listActiveProducts(businessId),
  ]);

  const totalValue = inventory.reduce((acc, r) => acc + r.value, 0);
  const totalItems = inventory.length;

  return (
    <>
      <PageHeader
        title="স্টক"
        subtitle="বর্তমান মজুদ, গড় ক্রয়মূল্য ও স্টক মূল্য"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="মোট স্টক মূল্য" value={formatMoney(totalValue)} tone="brand" />
        <StatCard label="পণ্যের ধরন" value={String(totalItems)} tone="blue" />
        <StatCard
          label="গড় মূল্য / পণ্য"
          value={formatMoney(totalItems ? totalValue / totalItems : 0)}
          tone="amber"
        />
      </div>

      {products.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>স্টক সামঞ্জস্য</CardTitle>
            </CardHeader>
            <CardContent>
              <AdjustmentForm products={products} action={applyAdjustmentAction} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>স্টক গণনা</CardTitle>
            </CardHeader>
            <CardContent>
              <StockCountForm
                products={products}
                createAction={createStockCountAction}
                confirmAction={confirmStockCountAction}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {inventory.length === 0 ? (
        <EmptyState
          title="স্টকে কোনও পণ্য নেই"
          description="ক্রয় বিল লেখার সাথে সাথে স্টক যোগ হবে।"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>পণ্য</Th>
                  <Th className="text-right">মজুদ</Th>
                  <Th className="text-right">গড় ক্রয়মূল্য</Th>
                  <Th className="text-right">স্টক মূল্য</Th>
                </Tr>
              </THead>
              <TBody>
                {inventory.map((r) => (
                  <Tr key={r.productId}>
                    <Td>
                      <p className="font-medium text-ink-900">{r.nameBn ?? r.name}</p>
                      {r.nameBn ? <p className="text-xs text-ink-400">{r.name}</p> : null}
                    </Td>
                    <Td className="text-right font-medium">
                      {formatQty(r.qty)} {r.unit}
                    </Td>
                    <Td className="text-right text-ink-500">
                      {formatMoney(r.avgCost)}
                    </Td>
                    <Td className="text-right font-medium">{formatMoney(r.value)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
