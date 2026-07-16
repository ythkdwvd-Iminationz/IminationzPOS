// Lightweight in-memory cache for data that's re-fetched on every tab focus
// (Billing, Inventory, Damaged all call api.listInventory() on every visit).
// Goal: switching tabs shows the last-known list instantly instead of a
// blank/loading state, while still revalidating in the background so data
// doesn't go stale for long. Pull-to-refresh / mutations bypass the cache.
import { api, InventoryItem } from "@/src/api/client";

const INVENTORY_TTL_MS = 30_000; // background-revalidate window for tab switches

let inventoryCache: InventoryItem[] | null = null;
let inventoryCachedAt = 0;
let inventoryInflight: Promise<InventoryItem[]> | null = null;

function isInventoryFresh() {
  return inventoryCache !== null && Date.now() - inventoryCachedAt < INVENTORY_TTL_MS;
}

/** Synchronous peek at whatever is cached right now (may be stale or null). */
export function peekInventory(): InventoryItem[] | null {
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
