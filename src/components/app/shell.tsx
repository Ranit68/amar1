"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X, ChevronsUpDown, Store } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV_GROUPS } from "@/components/app/nav";
import type { Permission } from "@/lib/permissions";
import { switchBusiness, signOut } from "@/app/(app)/actions";

export interface ShellMembership {
  businessId: string;
  name: string;
  role: string;
}

export interface ShellProps {
  children: ReactNode;
  userEmail: string;
  memberships: ShellMembership[];
  activeBusinessId: string;
  activeBusinessName: string;
  activeRole: string;
  permissions: Permission[];
}

const ROLE_LABEL: Record<string, string> = {
  owner: "মালিক",
  manager: "ম্যানেজার",
  staff: "কর্মী",
};

export function AppShell({
  children,
  userEmail,
  memberships,
  activeBusinessId,
  activeBusinessName,
  activeRole,
  permissions,
}: ShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const allowedGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permission || permissions.includes(item.permission),
    ),
  })).filter((group) => group.items.length > 0);

  const nav = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {allowedGroups.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
            {group.title}
          </p>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-brand-600 text-white shadow-sm"
                        : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide",
                        active ? "text-brand-100" : "text-ink-400",
                      )}
                    >
                      {item.labelEn}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const businessSwitcher = (
    <form action={switchBusiness} className="px-3 pb-2">
      <label className="sr-only" htmlFor="business-select">
        ব্যবসা বাছুন
      </label>
      <div className="relative">
        <Store className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <select
          id="business-select"
          name="business_id"
          defaultValue={activeBusinessId}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full appearance-none rounded-lg border border-ink-200 bg-white py-2 pl-9 pr-8 text-sm font-medium text-ink-800"
        >
          {memberships.map((m) => (
            <option key={m.businessId} value={m.businessId}>
              {m.name} · {ROLE_LABEL[m.role] ?? m.role}
            </option>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
    </form>
  );

  const footer = (
    <div className="border-t border-ink-200 p-3">
      <div className="mb-2 px-2">
        <p className="truncate text-sm font-medium text-ink-800">{userEmail}</p>
        <p className="text-xs text-ink-500">{ROLE_LABEL[activeRole] ?? activeRole}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        >
          <LogOut className="h-4 w-4" />
          লগ আউট / Sign out
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-ink-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Store className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-ink-900">পাইকারি হিসাব</p>
            <p className="text-[11px] text-ink-400">Wholesale Manager</p>
          </div>
        </div>
        {businessSwitcher}
        {nav}
        {footer}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-ink-200 px-5">
              <p className="text-sm font-semibold text-ink-900">পাইকারি হিসাব</p>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1 text-ink-500 hover:bg-ink-100"
                aria-label="বন্ধ করুন"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {businessSwitcher}
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
            aria-label="মেনু"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900">
              {activeBusinessName}
            </p>
            <p className="text-xs text-ink-400">{ROLE_LABEL[activeRole] ?? activeRole}</p>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
