import { requireSession } from "@/lib/auth";
import { listExpenses } from "@/lib/data/reports";
import { listCashAccounts } from "@/lib/data/options";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ExpenseForm } from "@/components/forms/expense-form";
import { recordExpenseAction } from "./actions";

export default async function ExpensesPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const [expenses, accounts] = await Promise.all([
    listExpenses(businessId),
    listCashAccounts(businessId),
  ]);
  const total = expenses.reduce((acc, e) => acc + e.amount, 0);
  const canPost = session.active.permissions.includes("expenses.post");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <>
      <PageHeader title="খরচ" subtitle="দোকানের দৈনন্দিন খরচের হিসাব" />

      {canPost ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>নতুন খরচ যোগ করুন</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseForm
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              today={today}
              action={recordExpenseAction}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="মোট খরচ" value={formatMoney(total)} tone="red" />
        <StatCard label="এন্ট্রি সংখ্যা" value={String(expenses.length)} tone="blue" />
        <StatCard
          label="গড় খরচ"
          value={formatMoney(expenses.length ? total / expenses.length : 0)}
          tone="amber"
        />
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          title="কোনও খরচ নেই"
          description="খরচ এন্ট্রি RPC (record_expense) দিয়ে যোগ হবে।"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>তারিখ</Th>
                  <Th>খাত</Th>
                  <Th>বিবরণ</Th>
                  <Th>মাধ্যম</Th>
                  <Th className="text-right">টাকা</Th>
                </Tr>
              </THead>
              <TBody>
                {expenses.map((e) => (
                  <Tr key={e.id}>
                    <Td className="text-ink-500">{formatDate(e.date)}</Td>
                    <Td className="font-medium text-ink-900">{e.category}</Td>
                    <Td className="text-ink-500">{e.description ?? "—"}</Td>
                    <Td className="text-ink-500">{e.paymentMethod}</Td>
                    <Td className="text-right font-medium">{formatMoney(e.amount)}</Td>
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
