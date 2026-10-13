import { requireSession } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import {
  listActiveProducts,
  listCashAccounts,
  listHawkerOptions,
} from "@/lib/data/options";
import { BillForm } from "@/components/bills/bill-form";
import { PageHeader } from "@/components/ui/misc";
import { postSalesAction } from "./actions";

export default async function NewSalePage() {
  const session = await requireSession();
  const businessId = session.active.business.id;

  const [products, hawkers, cashAccounts] = await Promise.all([
    listActiveProducts(businessId),
    listHawkerOptions(businessId),
    listCashAccounts(businessId),
  ]);

  return (
    <>
      <PageHeader
        title="নতুন বিক্রয়"
        subtitle="হকারকে পণ্য বিক্রয় করুন — বিল, স্টক ও বাকি সব একসাথে আপডেট হবে"
      />
      <BillForm
        mode="sales"
        partners={hawkers}
        products={products}
        cashAccounts={cashAccounts}
        action={postSalesAction}
        today={todayISO()}
      />
    </>
  );
}
