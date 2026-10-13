import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, TrendingUp, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getDashboard } from "@/lib/data/dashboard";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";

const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  paid: "green",
  partial: "amber",
  unpaid: "red",
};

const STATUS_LABEL: Record<string, string> = {
  paid: "পরিশোধিত",
  partial: "আংশিক",
  unpaid: "বাকি",
};

export default async function DashboardPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const data = await getDashboard(businessId);

  return (
    <>
      <PageHeader
        title="ড্যাশবোর্ড"
        subtitle="আজকের বিক্রয়, বাকি টাকা ও স্টকের সারসংক্ষেপ"
        actions={
          <>
            <Link href="/sales/new" className={buttonClasses("primary", "sm")}>
              নতুন বিক্রয়
            </Link>
            <Link href="/purchases/new" className={buttonClasses("outline", "sm")}>
              নতুন ক্রয়
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="আজকের বিক্রয়"
          value={formatMoney(data.todaySales)}
          hint={`মুনাফা ${formatMoney(data.todayProfit)}`}
          tone="brand"
        />
        <StatCard
          label="পাওনা (বাকি)"
          value={formatMoney(data.receivables)}
          hint="হকারদের কাছে"
          tone="amber"
        />
        <StatCard
          label="দেনা (বাকি)"
          value={formatMoney(data.payables)}
          hint="সরবরাহকারীকে"
          tone="red"
        />
        <StatCard
          label="কম স্টক পণ্য"
          value={String(data.lowStockCount)}
          hint="নূন্যতম সীমার নিচে"
          tone="blue"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>সাম্প্রতিক বিক্রয়</CardTitle>
            <Link
              href="/sales"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              সব দেখুন <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentSales.length === 0 ? (
              <div className="p-4">
                <EmptyState title="এখনও কোনও বিক্রয় নেই" />
              </div>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>বিল</Th>
                    <Th>হকার</Th>
                    <Th className="text-right">মোট</Th>
                    <Th className="text-right">বাকি</Th>
                    <Th>অবস্থা</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.recentSales.map((s) => (
                    <Tr key={s.id}>
                      <Td>
                        <p className="font-medium text-ink-900">
                          {s.invoiceNumber ?? "—"}
                        </p>
                        <p className="text-xs text-ink-400">{formatDate(s.date)}</p>
                      </Td>
                      <Td>{s.hawkerName}</Td>
                      <Td className="text-right font-medium">
                        {formatMoney(s.total)}
                      </Td>
                      <Td className="text-right">{formatMoney(s.outstanding)}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[s.paymentStatus] ?? "neutral"}>
                          {STATUS_LABEL[s.paymentStatus] ?? s.paymentStatus}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              কম স্টক
            </CardTitle>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              স্টক <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.lowStock.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="স্টক ঠিক আছে"
                  description="কোনও পণ্য ন্যূনতম সীমার নিচে নেই।"
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>পণ্য</Th>
                    <Th className="text-right">স্টক</Th>
                    <Th className="text-right">ন্যূনতম</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.lowStock.map((p) => (
                    <Tr key={p.productId}>
                      <Td>
                        <p className="font-medium text-ink-900">{p.nameBn ?? p.name}</p>
                        {p.nameBn ? (
                          <p className="text-xs text-ink-400">{p.name}</p>
                        ) : null}
                      </Td>
                      <Td className="text-right font-medium text-amber-600">
                        {formatQty(p.qty)} {p.unit}
                      </Td>
                      <Td className="text-right text-ink-500">
                        {formatQty(p.minStock)} {p.unit}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickAction
          href="/sales/new"
          title="বিক্রয় লিখুন"
          desc="হকারকে পণ্য বিক্রয় ও বিল তৈরি"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <QuickAction
          href="/payments"
          title="পেমেন্ট তোলা"
          desc="হকারের পাওনা সংগ্রহ করুন"
          icon={<Wallet className="h-5 w-5" />}
        />
        <QuickAction
          href="/scanner"
          title="বিল স্ক্যান"
          desc="কাগজের বিল ক্যামেরায় তুলুন"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>
    </>
  );
}

function QuickAction({
  href,
  title,
  desc,
  icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        <span className="block text-xs text-ink-500">{desc}</span>
      </span>
    </Link>
  );
}
