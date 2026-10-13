import type { ReactNode } from "react";
import { Store } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow">
            <Store className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-ink-900">পাইকারি হিসাব</h1>
          <p className="text-sm text-ink-500">
            দোকানের বিক্রয়, স্টক ও হিসাব এক জায়গায়
          </p>
        </div>
        <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
