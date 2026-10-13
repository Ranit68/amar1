import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-5xl font-semibold text-brand-700">৪০৪</p>
      <p className="text-lg font-medium text-ink-900">পাতাটি খুঁজে পাওয়া যায়নি</p>
      <p className="max-w-sm text-sm text-ink-500">The page you are looking for does not exist.</p>
      <Link href="/dashboard" className={buttonClasses("primary", "sm")}>
        ড্যাশবোর্ডে ফিরে যান
      </Link>
    </div>
  );
}
