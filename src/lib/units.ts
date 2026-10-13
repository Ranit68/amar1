export const UNIT_SUGGESTIONS = [
  { unit: "pcs", label: "পিস" },
  { unit: "dozen", label: "ডজন" },
  { unit: "kg", label: "কেজি" },
  { unit: "g", label: "গ্রাম" },
  { unit: "l", label: "লিটার" },
  { unit: "ml", label: "মিলি" },
  { unit: "bag", label: "বস্তা" },
  { unit: "box", label: "বাক্স" },
] as const;

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)] ?? d);
}

export function normalizeUnit(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export function formatQtyBn(value: number | string): string {
  return toBengaliDigits(String(value));
}
