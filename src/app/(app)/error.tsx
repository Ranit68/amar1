"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-300 bg-white px-6 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500" />
      <p className="text-base font-semibold text-ink-900">কিছু একটা ভুল হয়েছে</p>
      <p className="max-w-md text-sm text-ink-500">
        তথ্য লোড করতে সমস্যা হচ্ছে। আবার চেষ্টা করুন। Some data could not be loaded.
      </p>
      {error.digest ? <p className="text-xs text-ink-400">Ref: {error.digest}</p> : null}
      <Button type="button" onClick={reset} className="mt-2">
        আবার চেষ্টা করুন
      </Button>
    </div>
  );
}
