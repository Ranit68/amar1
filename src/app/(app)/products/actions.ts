"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function num(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function createProductAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.active.permissions.includes("products.write")) {
    return { error: "অনুমতি নেই / Missing permission: products.write" };
  }

  const name = str(formData, "name");
  if (!name) return { error: "পণ্যের নাম দিন / Name is required" };

  const baseUnit = str(formData, "base_unit") || "pcs";
  const sku = str(formData, "sku") || `SKU-${Date.now().toString(36).toUpperCase()}`;
  const categoryId = str(formData, "category_id");
  const barcode = str(formData, "barcode");
  const purchasePrice = num(formData, "purchase_price");
  const salePrice = num(formData, "sale_price");

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("products")
    .insert({
      business_id: session.active.business.id,
      name,
      name_bn: str(formData, "name_bn") || null,
      sku,
      barcode: barcode || null,
      category_id: categoryId || null,
      base_unit: baseUnit,
      purchase_unit: str(formData, "purchase_unit") || baseUnit,
      sell_unit: str(formData, "sell_unit") || baseUnit,
      min_stock: Number(str(formData, "min_stock") || "0"),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "এই SKU বা বারকোড আগে থেকেই আছে / SKU or barcode already exists" };
    }
    return { error: "সংরক্ষণ ব্যর্থ: " + error.message };
  }

  const prices: Array<{ type: "purchase" | "sale"; value: number | null }> = [
    { type: "purchase", value: purchasePrice },
    { type: "sale", value: salePrice },
  ];
  for (const price of prices) {
    if (price.value === null) continue;
    const { error: priceError } = await supabase.rpc("set_product_price", {
      p_product_id: created.id,
      p_price_type: price.type,
      p_unit: baseUnit,
      p_price: price.value,
    });
    if (priceError) {
      return {
        error: `পণ্য তৈরি হয়েছে কিন্তু দাম সংরক্ষণ ব্যর্থ: ${priceError.message}`,
      };
    }
  }

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleProductActiveAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session.active.permissions.includes("products.write")) return;

  const id = String(formData.get("id") ?? "");
  const nextActive = String(formData.get("is_active") ?? "") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("products")
    .update({ is_active: nextActive })
    .eq("id", id)
    .eq("business_id", session.active.business.id);

  revalidatePath("/products");
}
