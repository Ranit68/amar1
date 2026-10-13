import { requireSession } from "@/lib/auth";
import { getFinancialSummary, getMonthlyTrend } from "@/lib/data/reports";
import { formatMoney } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendChart } from "@/components/charts/trend-chart";

export default async function ReportsPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const [summary, trend] = await Promise.all([
    getFinancialSummary(businessId),
    getMonthlyTrend(businessId, 6),
  ]);
  const net = summary.monthGrossProfit - summary.monthExpenses;

  return (
    <>
      <PageHeader
        title="রিপোর্ট"
        subtitle={`চলতি মাসের আর্থিক সারসংক্ষেপ (${new Date().getFullYear()})`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="মাসিক বিক্রয়" value={formatMoney(summary.monthSales)} tone="brand" />
        <StatCard
          label="গ্রস মুনাফা"
          value={formatMoney(summary.monthGrossProfit)}
          tone="blue"
        />
        <StatCard label="মাসিক ক্রয়" value={formatMoney(summary.monthPurchases)} tone="amber" />
        <StatCard label="মাসিক খরচ" value={formatMoney(summary.monthExpenses)} tone="red" />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>৬ মাসের প্রবণতা</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data={trend} />
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>লাভ-ক্ষতি (চলতি মাস)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="বিক্রয়" value={formatMoney(summary.monthSales)} />
            {summary.monthSalesReturns > 0 ? (
              <Row label="বিক্রয় ফেরত" value={`- ${formatMoney(summary.monthSalesReturns)}`} />
            ) : null}
            <Row label="বিক্রয় মূল্য (ক্রয় খরচ)" value={`- ${formatMoney(summary.monthSales - summary.monthGrossProfit)}`} />
            <Row label="গ্রস মুনাফা" value={formatMoney(summary.monthGrossProfit)} strong />
            <Row label="খরচ" value={`- ${formatMoney(summary.monthExpenses)}`} />
            <div className="flex items-center justify-between border-t border-ink-100 pt-3 text-base">
              <span className="font-semibold text-ink-900">নিট (আনুমানিক)</span>
              <span className={net >= 0 ? "font-semibold text-brand-700" : "font-semibold text-red-600"}>
                {formatMoney(net)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>নগদ প্রবাহ (চলতি মাস)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="আজকের সংগ্রহ" value={formatMoney(summary.todayCollections)} />
            <Row label="মাসিক ক্রয়" value={formatMoney(summary.monthPurchases)} />
            {summary.monthPurchaseReturns > 0 ? (
              <Row label="ক্রয় ফেরত" value={`- ${formatMoney(summary.monthPurchaseReturns)}`} />
            ) : null}
            <Row label="মাসিক খরচ" value={formatMoney(summary.monthExpenses)} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={strong ? "font-semibold text-ink-900" : "text-ink-800"}>{value}</span>
    </div>
  );
}
