import { requireSession } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import {
  listReturnProducts,
  listApprovedSalesBills,
  listCashAccounts,
  listHawkerOptions,
} from "@/lib/data/options";
import { ReturnForm } from "@/components/forms/return-form";
import { PageHeader } from "@/components/ui/misc";
import { postSalesReturnAction } from "./actions";

interface PageProps {
  searchParams: Promise<{ bill_id?: string }>;
}

export default async function SalesReturnPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const params = await searchParams;

  const [products, hawkers, cashAccounts, bills] = await Promise.all([
    listReturnProducts(businessId),
    listHawkerOptions(businessId),
    listCashAccounts(businessId),
    listApprovedSalesBills(businessId),
  ]);

  return (
    <>
      <PageHeader
        title="বিক্রয় রিটার্ন"
        subtitle="হকারের কাছ থেকে ফেরত নেওয়া পণ্য — স্টকে ফিরে আসবে এবং বাকি সামঞ্জস্য হবে"
      />
      <ReturnForm
        mode="sales"
        partners={hawkers}
        products={products}
        cashAccounts={cashAccounts}
        approvedBills={bills}
        initialBillId={params.bill_id ?? ""}
        today={todayISO()}
        action={postSalesReturnAction}
      />
    </>
  );
}