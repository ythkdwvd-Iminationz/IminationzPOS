import AsyncStorage from "@react-native-async-storage/async-storage";
import { InventoryItem, CustomerInfo } from "@/src/api/client";

// =====================================================================
// Parked Bills Persistence Service
// =====================================================================
// Same rationale as draftBillingStorage.ts (see that file for the full
// AsyncStorage-durability notes) — but stores a *list* of stashed bills
// instead of a single active one. Whenever a bill is parked, resumed, or
// discarded, the whole list is rewritten to this one key.
//
// Kept dumb on purpose: no business logic here, just read/write/clear the
// list. The billing screen owns when to park/resume/discard.
// =====================================================================

const PARKED_KEY = "iminationz:billing:parked:v1";

export interface ParkedCartLine {
  inv: InventoryItem;
  qty: number;
  customPrice?: number | null;
}

export interface ParkedBillRecord {
  id: string;
  label: string;
  parkedAt: number;
  cart: ParkedCartLine[];
  customerMobile: string;
  customerName: string;
  customerInfo: CustomerInfo | null;
  cashAmount: string;
  upiAmount: string;
}

export const parkedBillsStorage = {
  async load(): Promise<ParkedBillRecord[]> {
    try {
      const raw = await AsyncStorage.getItem(PARKED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as ParkedBillRecord[];
    } catch (e) {
      console.warn("[parkedBills] failed to load", e);
      return [];
    }
  },

  async save(list: ParkedBillRecord[]): Promise<void> {
    try {
      await AsyncStorage.setItem(PARKED_KEY, JSON.stringify(list));
    } catch (e) {
      // Same stance as draft storage: persistence is a safety net, not a
      // hard requirement — don't let a storage failure break the session.
      console.warn("[parkedBills] failed to save", e);
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PARKED_KEY);
    } catch (e) {
      console.warn("[parkedBills] failed to clear", e);
    }
  },
};
