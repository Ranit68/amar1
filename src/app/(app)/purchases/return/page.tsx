import { requireSession } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import {
  listReturnProducts,
  listApprovedPurchaseBills,
  listCashAccounts,
  listSupplierOptions,
} from "@/lib/data/options";
import { ReturnForm } from "@/components/forms/return-form";
import { PageHeader } from "@/components/ui/misc";
import { postPurchaseReturnAction } from "./actions";

interface PageProps {
  searchParams: Promise<{ bill_id?: string }>;
}

export default async function PurchaseReturnPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const params = await searchParams;

  const [products, suppliers, cashAccounts, bills] = await Promise.all([
    listReturnProducts(businessId),
    listSupplierOptions(businessId),
    listCashAccounts(businessId),
    listApprovedPurchaseBills(businessId),
  ]);

  return (
    <>
      <PageHeader
        title="ক্রয় রিটার্ন"
        subtitle="সরবরাহকারীকে ফেরত দেওয়া পণ্য — স্টক ও বাকি সামঞ্জস্য হবে"
      />
      <ReturnForm
        mode="purchases"
        partners={suppliers}
        products={products}
        cashAccounts={cashAccounts}
        approvedBills={bills}
        initialBillId={params.bill_id ?? ""}
        today={todayISO()}
        action={postPurchaseReturnAction}
      />
    </>
  );
}