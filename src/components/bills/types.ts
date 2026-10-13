export interface BillFormState {
  error?: string;
}

export interface BillPartner {
  id: string;
  name: string;
}

export interface BillProduct {
  id: string;
  name: string;
  nameBn: string | null;
  baseUnit: string;
  purchaseUnit: string;
  sellUnit: string;
  avgCost?: number;
  unitFactors?: Record<string, number | null>;
}

export interface BillCashAccount {
  id: string;
  name: string;
  kind: string;
  balance: number;
}

export type BillMode = "sales" | "purchases";
