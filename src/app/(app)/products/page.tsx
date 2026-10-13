import { requireSession } from "@/lib/auth";
import { listCategories, listProducts } from "@/lib/data/lists";
import { formatQty } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ProductForm } from "@/components/forms/product-form";
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
          {products.length === 0 ? (
            <EmptyState
              title="কোনও পণ্য নেই"
              description="বাম দিকের ফর্ম থেকে প্রথম পণ্য যোগ করুন।"
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>পণ্য</Th>
                      <Th>SKU</Th>
                      <Th>বিভাগ</Th>
                      <Th className="text-right">ন্যূনতম</Th>
                      <Th>অবস্থা</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {products.map((p) => (
                      <Tr key={p.id}>
                        <Td>
                          <p className="font-medium text-ink-900">{p.nameBn ?? p.name}</p>
                          {p.nameBn ? (
                            <p className="text-xs text-ink-400">{p.name}</p>
                          ) : null}
                        </Td>
                        <Td className="text-ink-500">{p.sku}</Td>
                        <Td className="text-ink-500">{p.categoryName ?? "—"}</Td>
                        <Td className="text-right">
                          {formatQty(p.minStock)} {p.baseUnit}
                        </Td>
                        <Td>
                          {p.isActive ? (
                            <Badge tone="green">সক্রিয়</Badge>
                          ) : (
                            <Badge tone="neutral">নিষ্ক্রিয়</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
