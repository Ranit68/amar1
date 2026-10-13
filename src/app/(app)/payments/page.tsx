import { requireSession, hasPermission } from "@/lib/auth";
import {
  listCashAccounts,
  listHawkerOptions,
  listOpenPurchaseBills,
  listOpenSalesBills,
  listSupplierOptions,
} from "@/lib/data/options";
import { listRecentPayments } from "@/lib/data/lists";
import { getFinancialSummary } from "@/lib/data/reports";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaymentForm } from "@/components/forms/payment-form";
import { postPaymentAction } from "./actions";

const METHOD_LABEL: Record<string, string> = {
  cash: "নগদ",
  upi: "UPI",
  bank: "ব্যাঙ্ক",
  cheque: "চেক",
  credit: "বাকি",
  other: "অন্যান্য",
};

export default async function PaymentsPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;

  const [accounts, summary, hawkers, suppliers, customerBills, supplierBills, recent] =
    await Promise.all([
      listCashAccounts(businessId),
      getFinancialSummary(businessId),
      listHawkerOptions(businessId),
      listSupplierOptions(businessId),
      listOpenSalesBills(businessId),
      listOpenPurchaseBills(businessId),
      listRecentPayments(businessId),
    ]);

  return (
    <>
      <PageHeader
        title="পেমেন্ট"
        subtitle="হকার থেকে জমা ও সরবরাহকারীকে পরিশোধ"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="আজকের সংগ্রহ"
          value={formatMoney(summary.todayCollections)}
          tone="brand"
        />
        <StatCard
          label="আজকের বিক্রয়"
          value={formatMoney(summary.monthSales)}
          hint="এই মাসে"
          tone="blue"
        />
        <StatCard label="এই মাসের খরচ" value={formatMoney(summary.monthExpenses)} tone="amber" />
      </div>

      {hasPermission(session, "payments.post") ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>নতুন জমা / পরিশোধ</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentForm
              action={postPaymentAction}
              hawkers={hawkers}
              suppliers={suppliers}
              accounts={accounts}
              customerBills={customerBills}
              supplierBills={supplierBills}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>ক্যাশ ও ব্যাঙ্ক অ্যাকাউন্ট</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-ink-100">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{a.name}</p>
                  <div className="mt-0.5">
                    <Badge tone={a.kind === "cash" ? "brand" : "blue"}>
                      {a.kind === "cash" ? "নগদ" : a.kind === "bank" ? "ব্যাঙ্ক" : "UPI"}
                    </Badge>
                  </div>
                </div>
                <p className="text-lg font-semibold text-ink-900">{formatMoney(a.balance)}</p>
              </div>
            ))}
            {accounts.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-400">কোনও অ্যাকাউন্ট নেই।</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>সাম্প্রতিক লেনদেন</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-ink-100">
            {recent.map((p) => (
              <div key={`${p.partyType}-${p.id}`} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {p.partyName}
                    <span className="ml-2 text-xs">
                      <Badge tone={p.partyType === "customer" ? "green" : "amber"}>
                        {p.partyType === "customer" ? "জমা" : "পরিশোধ"}
                      </Badge>
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {formatDateTime(p.date)} · {METHOD_LABEL[p.method] ?? p.method}
                    {p.referenceNo ? ` · ${p.referenceNo}` : ""}
                  </p>
                </div>
                <p
                  className={
                    p.partyType === "customer"
                      ? "text-base font-semibold text-green-700"
                      : "text-base font-semibold text-red-700"
                  }
                >
                  {p.partyType === "customer" ? "+" : "−"}
                  {formatMoney(p.amount)}
                </p>
              </div>
            ))}
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-400">এখনও কোনও লেনদেন নেই।</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </>
  );
}