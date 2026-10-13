import {
  BarChart3,
  Boxes,
  Building2,
  Calculator,
  LayoutDashboard,
  Package,
  Receipt,
  ScanLine,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  labelEn: string;
  icon: LucideIcon;
  permission?: Permission;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "পরিচালনা",
    items: [
      { href: "/dashboard", label: "ড্যাশবোর্ড", labelEn: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
      { href: "/sales", label: "বিক্রয়", labelEn: "Sales", icon: ShoppingCart, permission: "sales.post" },
      { href: "/purchases", label: "ক্রয়", labelEn: "Purchases", icon: Truck, permission: "purchases.post" },
      { href: "/inventory", label: "স্টক", labelEn: "Inventory", icon: Boxes, permission: "inventory.write" },
    ],
  },
  {
    title: "তথ্যভান্ডার",
    items: [
      { href: "/products", label: "পণ্য", labelEn: "Products", icon: Package, permission: "products.write" },
      { href: "/hawkers", label: "হকার / ক্রেতা", labelEn: "Hawkers", icon: Users, permission: "hawkers.write" },
      { href: "/suppliers", label: "সরবরাহকারী", labelEn: "Suppliers", icon: Building2, permission: "suppliers.write" },
    ],
  },
  {
    title: "হিসাব",
    items: [
      { href: "/payments", label: "পেমেন্ট", labelEn: "Payments", icon: Wallet, permission: "payments.post" },
      { href: "/expenses", label: "খরচ", labelEn: "Expenses", icon: Receipt, permission: "expenses.post" },
      { href: "/closing", label: "দৈনিক হিসাব", labelEn: "Daily Closing", icon: Calculator, permission: "closing.post" },
      { href: "/reports", label: "রিপোর্ট", labelEn: "Reports", icon: BarChart3, permission: "reports.view" },
    ],
  },
  {
    title: "টুলস",
    items: [
      { href: "/scanner", label: "বিল স্ক্যান", labelEn: "Scan Bill", icon: ScanLine, permission: "scanner.use" },
      { href: "/settings", label: "সেটিংস", labelEn: "Settings", icon: Settings, permission: "settings.manage" },
    ],
  },
];
