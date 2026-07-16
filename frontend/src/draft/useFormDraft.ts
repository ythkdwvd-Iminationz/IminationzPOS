import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, AppStateStatus } from "react-native";

// =====================================================================
// useFormDraft<T>
// =====================================================================
// Generic version of useDraftBilling for any other in-progress form
// (Inventory add/edit item, Expense entry, Damaged item form, Discount
// settings, etc). Backed by AsyncStorage so a form survives the app
// being backgrounded/killed mid-entry and resumes exactly where the
// user left off, the same way the Billing draft already does.
//
// Usage:
//   const draft = useFormDraft<MyFormShape>("iminationz:inventory:draft:v1");
//   // on mount: draft.restoring / draft.restoredDraft
//   // on every relevant state change: draft.scheduleSave({ ...fields })
//   // on successful save or explicit cancel: draft.clearDraft()
// =====================================================================

const SAVE_DEBOUNCE_MS = 400;

export function useFormDraft<T>(storageKey: string) {
  const [restoring, setRestoring] = useState(true);
  const [restoredDraft, setRestoredDraft] = useState<T | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestState = useRef<T | null>(null);
  const clearedRef = useRef(false);

  // ---- Restore once on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        const parsed = raw ? (JSON.parse(raw) as T) : null;
        if (!cancelled) setRestoredDraft(parsed);
      } catch (e) {
        console.warn(`[formDraft:${storageKey}] failed to load draft`, e);
        if (!cancelled) setRestoredDraft(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // ---- Flush immediately when the app backgrounds/inactivates ----
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        if (latestState.current && !clearedRef.current) {
          AsyncStorage.setItem(storageKey, JSON.stringify(latestState.current)).catch(() => {});
        }
      }
    });
    return () => sub.remove();
  }, [storageKey]);

  // ---- Debounced save, called on every relevant state change ----
  const scheduleSave = useCallback(
    (state: T) => {
      latestState.current = state;
      clearedRef.current = false;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (latestState.current && !clearedRef.current) {
          AsyncStorage.setItem(storageKey, JSON.stringify(latestState.current)).catch((e) => {
            console.warn(`[formDraft:${storageKey}] failed to save draft`, e);
          });
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [storageKey]
  );

  // ---- Clear draft: call on successful save or explicit cancel/close ----
  const clearDraft = useCallback(async () => {
    clearedRef.current = true;
    latestState.current = null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch (e) {
      console.warn(`[formDraft:${storageKey}] failed to clear draft`, e);
    }
    setRestoredDraft(null);
  }, [storageKey]);

  return {
    restoring,
    restoredDraft,
    scheduleSave,
    clearDraft,
  };
}
