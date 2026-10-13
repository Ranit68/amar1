import { Badge } from "@/components/ui/badge";

const PAYMENT_TONE = { paid: "green", partial: "amber", unpaid: "red" } as const;
const PAYMENT_LABEL: Record<string, string> = {
  paid: "পরিশোধিত",
  partial: "আংশিক",
  unpaid: "বাকি",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const tone = (PAYMENT_TONE as Record<string, "green" | "amber" | "red">)[status] ?? "neutral";
  return <Badge tone={tone}>{PAYMENT_LABEL[status] ?? status}</Badge>;
}

const BILL_TONE = {
  draft: "neutral",
  pending_review: "amber",
  approved: "green",
  rejected: "red",
  void: "neutral",
} as const;
const BILL_LABEL: Record<string, string> = {
  draft: "খসড়া",
  pending_review: "পর্যালোচনা",
  approved: "অনুমোদিত",
  rejected: "বাতিল",
  void: "বাতিল",
};

export function BillStatusBadge({ status }: { status: string }) {
  const tone =
    (BILL_TONE as Record<string, "neutral" | "amber" | "green" | "red">)[status] ??
    "neutral";
  return <Badge tone={tone}>{BILL_LABEL[status] ?? status}</Badge>;
}
