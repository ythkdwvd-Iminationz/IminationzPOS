import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  draftBillingStorage,
  BillingDraft,
  DraftCartLine,
} from "./draftBillingStorage";
import { CustomerInfo } from "@/src/api/client";

// =====================================================================
// useDraftBilling
// =====================================================================
// Reusable hook: any screen that needs "auto-save + restore" billing-like
// state can use this same pattern. It is intentionally generic about
// *what* it saves (the caller passes the current state in) and only
// owns *when* it saves (debounced on change, plus immediately on
// backgrounding) and *how* it's restored (once, on mount).
//
// Usage in billing.tsx:
//   const draft = useDraftBilling();
//   // on mount: draft.restoring / draft.restoredDraft
//   // on every relevant state change: draft.scheduleSave({ cart, ...})
//   // on successful bill submit or explicit cancel: draft.clearDraft()
// =====================================================================

export interface DraftBillingState {
  cart: DraftCartLine[];
  cashAmount: string;
  upiAmount: string;
  tempCustomerMobile: string;
  tempCustomerName: string;
  tempCustomerInfo: CustomerInfo | null;
  notes?: string;
  discountOverride?: number;
  taxRate?: number;
  paymentMethod?: string;
}

const SAVE_DEBOUNCE_MS = 400;

export function useDraftBilling() {
  const [restoring, setRestoring] = useState(true);
  const [restoredDraft, setRestoredDraft] = useState<BillingDraft | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestState = useRef<DraftBillingState | null>(null);
  // Guards against writing a draft back to disk right after we've just
  // cleared it (e.g. a stray debounced save firing after submit/cancel).
  const clearedRef = useRef(false);

  // ---- Restore once on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await draftBillingStorage.load();
      if (!cancelled) {
        setRestoredDraft(existing);
        setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Flush immediately when the app backgrounds/inactivates ----
  // This is the critical bit for the Android "switch to UPI app" case:
  // we don't want to rely solely on the debounce timer firing before the
  // OS suspends/kills the JS thread. AppState going to "background" or
  // "inactive" triggers an immediate synchronous-as-possible flush of
  // whatever the latest known state was.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        if (latestState.current && !clearedRef.current) {
          // Fire and forget — we're racing the OS suspending us, so we
          // can't await this, but AsyncStorage writes are fast and this
          // gives the best possible chance of landing before suspension.
          draftBillingStorage.save(latestState.current);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // ---- Debounced save, called on every relevant state change ----
  const scheduleSave = useCallback((state: DraftBillingState) => {
    latestState.current = state;
    clearedRef.current = false;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (latestState.current && !clearedRef.current) {
        draftBillingStorage.save(latestState.current);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // ---- Clear draft: call on successful bill submit or explicit cancel ----
  const clearDraft = useCallback(async () => {
    clearedRef.current = true;
    latestState.current = null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await draftBillingStorage.clear();
    setRestoredDraft(null);
  }, []);

  // ---- Explicitly consume/dismiss the restored draft banner without ----
  // ---- deleting the underlying saved data (rare; usually you either ----
  // ---- apply it or clear it, but exposed for flexibility) ----
  const dismissRestoredBanner = useCallback(() => {
    setRestoredDraft(null);
  }, []);

  return {
    restoring,
    restoredDraft,
    scheduleSave,
    clearDraft,
    dismissRestoredBanner,
  };
}
