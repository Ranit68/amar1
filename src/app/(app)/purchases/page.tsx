import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listPurchases } from "@/lib/data/lists";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";
import { PaymentStatusBadge, BillStatusBadge } from "@/components/app/status-badge";
import { VoidBillButton } from "@/components/bills/void-button";
import { voidPurchaseBillAction } from "./actions";

export default async function PurchasesPage() {
  const session = await requireSession();
  const purchases = await listPurchases(session.active.business.id);

  return (
    <>
      <PageHeader
        title="ক্রয়"
        subtitle="সরবরাহকারীর বিলের তালিকা"
        actions={
          <Link href="/purchases/new" className={buttonClasses("primary", "sm")}>
            নতুন ক্রয়
          </Link>
        }
      />
      {purchases.length === 0 ? (
        <EmptyState
          title="এখনও কোনও ক্রয় নেই"
          description="সরবরাহকারীর প্রথম বিল লিখুন।"
          action={
            <Link href="/purchases/new" className={buttonClasses("primary", "sm")}>
              নতুন ক্রয়
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
                  <Th>সরবরাহকারী</Th>
                  <Th>তারিখ</Th>
                  <Th className="text-right">মোট</Th>
                  <Th className="text-right">বাকি</Th>
                  <Th>অবস্থা</Th>
                  <Th className="text-right">ক্রিয়া</Th>
                </Tr>
              </THead>
              <TBody>
                {purchases.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium text-ink-900">{p.invoiceNumber ?? "—"}</Td>
                    <Td>{p.supplierName}</Td>
                    <Td className="text-ink-500">{formatDate(p.date)}</Td>
                    <Td className="text-right font-medium">{formatMoney(p.total)}</Td>
                    <Td className="text-right">{formatMoney(p.outstanding)}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <PaymentStatusBadge status={p.paymentStatus} />
                        <BillStatusBadge status={p.status} />
                      </div>
                    </Td>
                    <Td className="text-right">
                      {p.status === "approved" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/purchases/return?bill_id=${p.id}`}
                            className={buttonClasses("outline", "sm")}
                          >
                            রিটার্ন
                          </Link>
                          <VoidBillButton action={voidPurchaseBillAction} billId={p.id} />
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
