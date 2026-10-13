import { requireSession } from "@/lib/auth";
import { listHawkers } from "@/lib/data/lists";
import { formatMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { HawkerForm } from "@/components/forms/hawker-form";
import { createHawkerAction } from "./actions";

export default async function HawkersPage() {
  const session = await requireSession();
  const hawkers = await listHawkers(session.active.business.id);

  return (
    <>
      <PageHeader title="হকার / ক্রেতা" subtitle="বিক্রেতা-ক্রেতার তালিকা ও তাদের বাকি" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>নতুন হকার</CardTitle>
          </CardHeader>
          <CardContent>
            <HawkerForm action={createHawkerAction} />
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {hawkers.length === 0 ? (
            <EmptyState title="কোনও হকার নেই" description="প্রথম হকার যোগ করুন।" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>নাম</Th>
                      <Th>ফোন</Th>
                      <Th className="text-right">বাকি (পাওনা)</Th>
                      <Th className="text-right">ঋণসীমা</Th>
                      <Th>অবস্থা</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {hawkers.map((h) => (
                      <Tr key={h.id}>
                        <Td className="font-medium text-ink-900">{h.name}</Td>
                        <Td className="text-ink-500">{h.phone ?? "—"}</Td>
                        <Td className="text-right font-medium text-amber-600">
                          {formatMoney(h.balance)}
                        </Td>
                        <Td className="text-right text-ink-500">
                          {h.creditLimit === null ? "সীমা নেই" : formatMoney(h.creditLimit)}
                        </Td>
                        <Td>
                          {h.isActive ? (
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
