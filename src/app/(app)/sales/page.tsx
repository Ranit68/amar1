import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listSales } from "@/lib/data/lists";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";
import { PaymentStatusBadge, BillStatusBadge } from "@/components/app/status-badge";
import { VoidBillButton } from "@/components/bills/void-button";
import { voidSalesBillAction } from "./actions";

export default async function SalesPage() {
  const session = await requireSession();
  const sales = await listSales(session.active.business.id);

  return (
    <>
      <PageHeader
        title="বিক্রয়"
        subtitle="সব বিক্রয় বিলের তালিকা"
        actions={
          <Link href="/sales/new" className={buttonClasses("primary", "sm")}>
            নতুন বিক্রয়
          </Link>
        }
      />
      {sales.length === 0 ? (
        <EmptyState
          title="এখনও কোনও বিক্রয় নেই"
          description="প্রথম বিক্রয় বিল তৈরি করুন।"
          action={
            <Link href="/sales/new" className={buttonClasses("primary", "sm")}>
              নতুন বিক্রয়
            </Link>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>বিল</Th>
                  <Th>হকার</Th>
                  <Th>তারিখ</Th>
                  <Th className="text-right">মোট</Th>
                  <Th className="text-right">বাকি</Th>
                  <Th>অবস্থা</Th>
                  <Th className="text-right">ক্রিয়া</Th>
                </Tr>
              </THead>
              <TBody>
                {sales.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium text-ink-900">{s.invoiceNumber ?? "—"}</Td>
                    <Td>{s.hawkerName}</Td>
                    <Td className="text-ink-500">{formatDate(s.date)}</Td>
                    <Td className="text-right font-medium">{formatMoney(s.total)}</Td>
                    <Td className="text-right">{formatMoney(s.outstanding)}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <PaymentStatusBadge status={s.paymentStatus} />
                        <BillStatusBadge status={s.status} />
                      </div>
                    </Td>
                    <Td className="text-right">
                      {s.status === "approved" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/sales/return?bill_id=${s.id}`}
                            className={buttonClasses("outline", "sm")}
                          >
                            রিটার্ন
                          </Link>
                          <VoidBillButton action={voidSalesBillAction} billId={s.id} />
                        </div>
                      ) : null}
                    </Td>
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
