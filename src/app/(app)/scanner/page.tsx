import { requireSession } from "@/lib/auth";
import {
  listActiveProducts,
  listHawkerOptions,
  listSupplierOptions,
} from "@/lib/data/options";
import { PageHeader } from "@/components/ui/misc";
import { ScanUploader } from "@/components/scanner/scan-uploader";
import { postScannedBillAction } from "./actions";

export default async function ScannerPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const [products, hawkers, suppliers] = await Promise.all([
    listActiveProducts(businessId),
    listHawkerOptions(businessId),
    listSupplierOptions(businessId),
  ]);

  return (
    <>
      <PageHeader
        title="বিল স্ক্যান"
        subtitle="কাগজের বিলের ছবি তুলে পণ্যের তালিকা বের করুন ও বিল তৈরি করুন"
      />
      <ScanUploader
        products={products}
        hawkers={hawkers}
        suppliers={suppliers}
        action={postScannedBillAction}
      />
    </>
  );
}
