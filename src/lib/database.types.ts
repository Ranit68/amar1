/**
 * Hand-maintained types for the `public` schema of the Supabase database.
 * Kept in sync with supabase/migrations. Only columns used by the app are
 * listed; extend as modules are built out.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Business = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  locale: "bn" | "en";
  settings: Json;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  locale: "bn" | "en";
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type BusinessMember = {
  id: string;
  business_id: string;
  user_id: string;
  role: "owner" | "manager" | "staff";
  member_permissions: string[];
  status: "active" | "suspended" | "removed";
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Category = {
  id: string;
  business_id: string;
  name: string;
  name_bn: string | null;
  created_at: string;
}

export type Product = {
  id: string;
  business_id: string;
  sku: string;
  name: string;
  name_bn: string | null;
  name_en: string | null;
  brand: string | null;
  category_id: string | null;
  barcode: string | null;
  base_unit: string;
  purchase_unit: string;
  sell_unit: string;
  min_stock: number;
  max_stock: number | null;
  track_expiry: boolean;
  track_batch: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductUnit = {
  id: string;
  business_id: string;
  product_id: string;
  unit: string;
  unit_norm: string;
  factor_to_base: number;
  created_at: string;
}

export type UnitDimension = {
  unit: string;
  dimension: "count" | "mass" | "volume";
  factor: number;
}

export type Supplier = {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  credit_days: number;
  opening_balance: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type Hawker = {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  address_area: string | null;
  credit_limit: number | null;
  credit_days: number;
  opening_balance: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type InventoryBalance = {
  business_id: string;
  product_id: string;
  qty: number;
  avg_cost: number;
  last_movement_at: string | null;
  updated_at: string;
}

export type PurchaseBill = {
  id: string;
  business_id: string;
  supplier_id: string;
  invoice_number: string | null;
  invoice_date: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  freight_cost: number;
  other_costs: number;
  total: number;
  amount_paid: number;
  outstanding: number;
  payment_status: "unpaid" | "partial" | "paid";
  status: "draft" | "pending_review" | "approved" | "rejected" | "void";
  notes: string | null;
  created_at: string;
}

export type SalesBill = {
  id: string;
  business_id: string;
  hawker_id: string;
  invoice_number: string | null;
  invoice_date: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_received: number;
  outstanding: number;
  cost_of_goods: number;
  gross_profit: number;
  payment_status: "unpaid" | "partial" | "paid";
  status: "draft" | "pending_review" | "approved" | "rejected" | "void";
  notes: string | null;
  created_at: string;
}

export type CashAccount = {
  id: string;
  business_id: string;
  name: string;
  kind: "cash" | "bank" | "upi";
  opening_balance: number;
  current_balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Expense = {
  id: string;
  business_id: string;
  expense_date: string;
  amount: number;
  category_id: string | null;
  category: string;
  kind: string;
  description: string | null;
  payment_method: string;
  cash_account_id: string | null;
  is_paid: boolean;
  is_recurring: boolean;
  created_at: string;
}

export type DailyClosing = {
  id: string;
  business_id: string;
  closing_date: string;
  sales_total: number;
  collections: number;
  supplier_payments: number;
  expenses_paid: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  gross_profit: number;
  operating_expenses: number;
  net_operating_profit: number;
  status: "draft" | "confirmed";
  created_at: string;
}

export type AuditLog = {
  id: string;
  business_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  created_at: string;
}

type TableShape<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      businesses: TableShape<Business>;
      profiles: TableShape<Profile>;
      business_members: TableShape<BusinessMember>;
      categories: TableShape<Category>;
      products: TableShape<Product>;
      product_units: TableShape<ProductUnit>;
      unit_dimensions: TableShape<UnitDimension>;
      suppliers: TableShape<Supplier>;
      hawkers: TableShape<Hawker>;
      inventory_balances: TableShape<InventoryBalance>;
      purchase_bills: TableShape<PurchaseBill>;
      sales_bills: TableShape<SalesBill>;
      cash_accounts: TableShape<CashAccount>;
      expenses: TableShape<Expense>;
      daily_closings: TableShape<DailyClosing>;
      audit_logs: TableShape<AuditLog>;
    };
    Views: Record<string, never>;
    Functions: {
      app_permissions: {
        Args: { p_business_id: string };
        Returns: string[];
      };
      app_can: {
        Args: { p_business_id: string; p_permission: string };
        Returns: boolean;
      };
      hawker_balance: {
        Args: { p_hawker_id: string };
        Returns: number;
      };
      supplier_balance: {
        Args: { p_supplier_id: string };
        Returns: number;
      };
      resolve_unit_factor: {
        Args: { p_product_id: string; p_unit: string };
        Returns: number;
      };
      create_business: {
        Args: { p_name: string };
        Returns: string;
      };
      update_business: {
        Args: { p_business_id: string; p_name: string; p_locale: string };
        Returns: Json;
      };
      invite_member: {
        Args: { p_business_id: string; p_email: string; p_role: string };
        Returns: Json;
      };
      post_sales_bill: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      post_purchase_bill: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      void_sales_bill: {
        Args: { p_bill_id: string; p_reason?: string | null };
        Returns: Json;
      };
      void_purchase_bill: {
        Args: { p_bill_id: string; p_reason?: string | null };
        Returns: Json;
      };
      post_customer_payment: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      post_supplier_payment: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      record_expense: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      post_sales_return: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      post_purchase_return: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      confirm_daily_closing: {
        Args: {
          p_business_id: string;
          p_closing_date: string;
          p_counted_cash: number | null;
          p_notes: string | null;
        };
        Returns: Json;
      };
      apply_stock_adjustment: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      create_stock_count: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      confirm_stock_count: {
        Args: { p_count_id: string; p_notes?: string | null };
        Returns: Json;
      };
      total_receivables: {
        Args: { p_business_id: string };
        Returns: number;
      };
      total_payables: {
        Args: { p_business_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
