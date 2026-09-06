// Lightweight cache for data that's re-fetched on every tab focus
// (Billing, Inventory, Damaged all call api.listInventory() on every visit).
// Goal: switching tabs — and reopening the app — shows the last-known list
// instantly instead of a blank/loading state, while still revalidating in
// the background so data doesn't go stale for long. Pull-to-refresh /
// mutations bypass the cache.
//
// Two layers:
//   1. In-memory (inventoryCache) — resets on cold launch, serves repeat
//      tab switches within the same session without hitting the network.
//   2. On-device (AsyncStorage, via PERSIST_KEY) — survives app restarts,
//      so the very first screen after reopening the app can paint with
//      yesterday's known inventory immediately, instead of waiting on a
//      network round trip before showing anything.
import { api, InventoryItem } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const INVENTORY_TTL_MS = 30_000; // background-revalidate window for tab switches
const PERSIST_KEY = "cache:inventory:v1";

let inventoryCache: InventoryItem[] | null = null;
let inventoryCachedAt = 0;
let inventoryInflight: Promise<InventoryItem[]> | null = null;
let hydratedFromDisk = false;

function isInventoryFresh() {
  return inventoryCache !== null && Date.now() - inventoryCachedAt < INVENTORY_TTL_MS;
}

/** Synchronous peek at whatever is cached right now (may be stale or null).
 * Only reflects the in-memory layer — call hydrateInventoryFromDisk() once
 * at app start if you need the on-device snapshot before the first fetch
 * resolves. */
export function peekInventory(): InventoryItem[] | null {
  return inventoryCache;
}

/**
 * Load the last on-device snapshot (if any) into the in-memory cache. Meant
 * to be called once, early (e.g. from the root layout or first screen's
 * effect), so peekInventory() has something to return before the first
 * network fetch of this session completes. Does not mark the cache as
 * "fresh" — a background getInventory() call will still revalidate it.
 */
export async function hydrateInventoryFromDisk(): Promise<InventoryItem[] | null> {
  if (hydratedFromDisk || inventoryCache !== null) return inventoryCache;
  hydratedFromDisk = true;
  const raw = await storage.getItem<string>(PERSIST_KEY, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as InventoryItem[];
    if (Array.isArray(parsed)) {
      inventoryCache = parsed;
      // cachedAt stays 0 so isInventoryFresh() is false — this snapshot is
      // shown immediately but a real fetch still happens right after.
    }
  } catch {
    // Corrupt/old-format snapshot — ignore, next real fetch will repopulate.
  }
  return inventoryCache;
}

/**
 * Get inventory, serving from cache when fresh (<30s old) instead of
 * re-hitting Supabase on every tab focus. Pass force=true (pull-to-refresh,
 * or right after a mutation) to always fetch fresh data.
 */
export async function getInventory(force = false): Promise<InventoryItem[]> {
  if (!force && isInventoryFresh()) return inventoryCache!;
  if (!force && inventoryInflight) return inventoryInflight;

  const p = api
    .listInventory()
    .then((data) => {
      inventoryCache = data;
      inventoryCachedAt = Date.now();
      inventoryInflight = null;
      // Fire-and-forget: persist for next cold launch. Failure here should
      // never block or break the in-memory result callers are waiting on.
      storage.setItem<string>(PERSIST_KEY, JSON.stringify(data)).catch(() => {});
      return data;
    })
    .catch((e) => {
      inventoryInflight = null;
      throw e;
    });
  inventoryInflight = p;
  return p;
}

/** Call after any inventory create/update/delete/stock-changing action so
 * every other screen re-fetches fresh data on its next focus/refresh. */
export function invalidateInventory() {
  inventoryCache = null;
  inventoryCachedAt = 0;
  inventoryInflight = null;
}
