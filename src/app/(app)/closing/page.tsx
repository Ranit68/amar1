import { requireSession } from "@/lib/auth";
import { listClosings } from "@/lib/data/reports";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ClosingForm } from "@/components/forms/closing-form";
import { confirmClosingAction } from "./actions";

export default async function ClosingPage() {
  const session = await requireSession();
  const closings = await listClosings(session.active.business.id);
  const canPost = session.active.permissions.includes("closing.post");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <>
      <PageHeader
        title="দৈনিক হিসাব"
        subtitle="দিনের বিক্রয়, সংগ্রহ ও নগদ মেলানোর হিসাব"
      />

      {canPost ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>দিনের হিসাব মেলান</CardTitle>
          </CardHeader>
          <CardContent>
            <ClosingForm today={today} action={confirmClosingAction} />
          </CardContent>
        </Card>
      ) : null}

      {closings.length === 0 ? (
        <EmptyState
          title="এখনও কোনও দৈনিক হিসাব নেই"
          description="দিনশেষে confirm_daily_closing RPC দিয়ে হিসাব মিলানো হবে।"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>তারিখ</Th>
                  <Th className="text-right">বিক্রয়</Th>
                  <Th className="text-right">সংগ্রহ</Th>
                  <Th className="text-right">প্রত্যাশিত নগদ</Th>
                  <Th className="text-right">গণনা করা</Th>
                  <Th className="text-right">পার্থক্য</Th>
                  <Th>অবস্থা</Th>
                </Tr>
              </THead>
              <TBody>
                {closings.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-medium text-ink-900">{formatDate(c.date)}</Td>
                    <Td className="text-right">{formatMoney(c.salesTotal)}</Td>
                    <Td className="text-right">{formatMoney(c.collections)}</Td>
                    <Td className="text-right">{formatMoney(c.expectedCash)}</Td>
                    <Td className="text-right">
                      {c.countedCash === null ? "—" : formatMoney(c.countedCash)}
                    </Td>
                    <Td
                      className={
                        c.difference === null
                          ? "text-right"
                          : c.difference === 0
                            ? "text-right text-brand-700"
                            : "text-right text-red-600"
                      }
                    >
                      {c.difference === null ? "—" : formatMoney(c.difference)}
                    </Td>
                    <Td>
                      {c.status === "confirmed" ? (
                        <Badge tone="green">নিশ্চিত</Badge>
                      ) : (
                        <Badge tone="amber">খসড়া</Badge>
                      )}
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
