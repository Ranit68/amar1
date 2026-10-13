import { requireSession } from "@/lib/auth";
import { listSuppliers } from "@/lib/data/lists";
import { formatMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { SupplierForm } from "@/components/forms/supplier-form";
import { createSupplierAction } from "./actions";

export default async function SuppliersPage() {
  const session = await requireSession();
  const suppliers = await listSuppliers(session.active.business.id);

  return (
    <>
      <PageHeader title="সরবরাহকারী" subtitle="সরবরাহকারীর তালিকা ও দেনা" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>নতুন সরবরাহকারী</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierForm action={createSupplierAction} />
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {suppliers.length === 0 ? (
            <EmptyState title="কোনও সরবরাহকারী নেই" description="প্রথম সরবরাহকারী যোগ করুন।" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>নাম</Th>
                      <Th>ফোন</Th>
                      <Th className="text-right">দেনা (বাকি)</Th>
                      <Th className="text-right">ঋণ দিন</Th>
                      <Th>অবস্থা</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {suppliers.map((s) => (
                      <Tr key={s.id}>
                        <Td className="font-medium text-ink-900">{s.name}</Td>
                        <Td className="text-ink-500">{s.phone ?? "—"}</Td>
                        <Td className="text-right font-medium text-red-600">
                          {formatMoney(s.balance)}
                        </Td>
                        <Td className="text-right text-ink-500">{s.creditDays}</Td>
                        <Td>
                          {s.isActive ? (
                            <Badge tone="green">সক্রিয়</Badge>
                          ) : (
                            <Badge tone="neutral">নিষ্ক্রিয়</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
