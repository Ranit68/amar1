import { requireSession } from "@/lib/auth";
import { listCategories, listProducts } from "@/lib/data/lists";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/components/forms/product-form";
import { ProductSearch } from "@/components/app/product-search";
import { createProductAction } from "./actions";

export default async function ProductsPage() {
  const session = await requireSession();
  const businessId = session.active.business.id;
  const [products, categories] = await Promise.all([
    listProducts(businessId),
    listCategories(businessId),
  ]);

  return (
    <>
      <PageHeader title="পণ্য" subtitle="পণ্যের তালিকা ও নতুন পণ্য যোগ করুন" />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>নতুন পণ্য</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm categories={categories} action={createProductAction} />
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <ProductSearch products={products} />
        </div>
      </div>
    </>
  );
}
