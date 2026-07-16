import AsyncStorage from "@react-native-async-storage/async-storage";
import { InventoryItem, CustomerInfo } from "@/src/api/client";

// =====================================================================
// Draft Billing Persistence Service
// =====================================================================
// Backed by AsyncStorage (the RN/Expo equivalent of IndexedDB — IndexedDB
// itself is a browser-only API and does not exist in React Native).
// AsyncStorage writes to disk on Android/iOS and survives:
//   - OS killing the app in the background (e.g. switching to a UPI app)
//   - Force-quits / crashes
//   - Cold app restarts
// It does NOT survive app uninstall or explicit "clear app data" — same
// as IndexedDB not surviving a browser profile wipe, so this is the
// correct native parity.
//
// Keep this service dumb: it only knows how to read/write/clear a single
// JSON blob under one key. All business logic (what counts as "changed",
// when to save) lives in the useDraftBilling hook that wraps it.
// =====================================================================

const DRAFT_KEY = "iminationz:billing:draft:v1";

// Mirrors the CartLine shape in billing.tsx, but stored as plain data
// (no functions) since AsyncStorage only holds JSON-serializable values.
export interface DraftCartLine {
  inv: InventoryItem;
  qty: number;
  customPrice?: number | null;
}

// Full shape of everything the billing screen needs to fully restore.
// Extend this if you add more billing state later (taxes, notes, etc.)
// — it's already future-proofed with optional fields for exactly that.
export interface BillingDraft {
  cart: DraftCartLine[];
  cashAmount: string;
  upiAmount: string;
  // Customer details as entered in the customer modal, kept even before
  // "Complete Bill" is pressed so a mid-entry customer name/mobile also
  // survives an interruption.
  tempCustomerMobile: string;
  tempCustomerName: string;
  tempCustomerInfo: CustomerInfo | null;
  // Reserved for future fields (discount overrides, notes, tax rate,
  // payment method selector, etc.) without needing another migration.
  notes?: string;
  discountOverride?: number;
  taxRate?: number;
  paymentMethod?: string;
  // Bookkeeping
  savedAt: string; // ISO timestamp, useful for debugging / "resume draft from X" UI
  draftVersion: 1;
}

export const draftBillingStorage = {
  async save(draft: Omit<BillingDraft, "savedAt" | "draftVersion">): Promise<void> {
    const full: BillingDraft = {
      ...draft,
      savedAt: new Date().toISOString(),
      draftVersion: 1,
    };
    try {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(full));
    } catch (e) {
      // Storage failures shouldn't crash billing — draft persistence is
      // a safety net, not a hard requirement for the current session to
      // keep working. Swallow and let the in-memory state carry on.
      console.warn("[draftBilling] failed to save draft", e);
    }
  },

  async load(): Promise<BillingDraft | null> {
    try {
      const raw = await AsyncStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as BillingDraft;
      // Basic shape guard in case of a future format change or corruption.
      if (!parsed || !Array.isArray(parsed.cart)) return null;
      return parsed;
    } catch (e) {
      console.warn("[draftBilling] failed to load draft", e);
      return null;
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn("[draftBilling] failed to clear draft", e);
    }
  },

  async hasDraft(): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(DRAFT_KEY);
      return !!raw;
    } catch {
      return false;
    }
  },
};
