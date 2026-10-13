import { requireSession } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import {
  listActiveProducts,
  listCashAccounts,
  listSupplierOptions,
} from "@/lib/data/options";
import { BillForm } from "@/components/bills/bill-form";
import { PageHeader } from "@/components/ui/misc";
import { postPurchaseAction } from "./actions";

export default async function NewPurchasePage() {
  const session = await requireSession();
  const businessId = session.active.business.id;

  const [products, suppliers, cashAccounts] = await Promise.all([
    listActiveProducts(businessId),
    listSupplierOptions(businessId),
    listCashAccounts(businessId),
  ]);

  return (
    <>
      <PageHeader
        title="নতুন ক্রয়"
        subtitle="সরবরাহকারীর বিল লিখুন — স্টক ও ক্রয় মূল্য স্বয়ংক্রিয়ভাবে হিসাব হবে"
      />
      <BillForm
        mode="purchases"
        partners={suppliers}
        products={products}
        cashAccounts={cashAccounts}
        action={postPurchaseAction}
        today={todayISO()}
      />
    </>
  );
}
