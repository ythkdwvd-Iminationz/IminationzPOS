import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import {
  api,
  damagedApi,
  DamagedItem,
  DamagedSummary,
  InventoryItem,
} from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";
import { useFormDraft } from "@/src/draft/useFormDraft";

type FilterTab = "in_stock" | "sold" | "discarded" | "all";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "in_stock", label: "In Stock" },
  { key: "sold", label: "Sold" },
  { key: "discarded", label: "Discarded" },
  { key: "all", label: "All" },
];

interface MarkDraft {
  markOpen: boolean;
  selectedInv: InventoryItem | null;
  markQty: string;
  markReason: string;
}

interface SellDraft {
  sellOpen: boolean;
  sellTarget: DamagedItem | null;
  sellPrice: string;
  sellNote: string;
}

const MARK_DRAFT_KEY = "iminationz:damaged:mark:draft:v1";
const SELL_DRAFT_KEY = "iminationz:damaged:sell:draft:v1";

export default function DamagedScreen() {
  const [items, setItems] = useState<DamagedItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<DamagedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<FilterTab>("in_stock");
  const [error, setError] = useState<string | null>(null);

  // Mark-damaged modal state
  const [markOpen, setMarkOpen] = useState(false);
  const [invSearch, setInvSearch] = useState("");
  const [selectedInv, setSelectedInv] = useState<InventoryItem | null>(null);
  const [markQty, setMarkQty] = useState("1");
  const [markReason, setMarkReason] = useState("");
  const [markSaving, setMarkSaving] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  // Sell modal state
  const [sellOpen, setSellOpen] = useState(false);
  const [sellTarget, setSellTarget] = useState<DamagedItem | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [sellNote, setSellNote] = useState("");
  const [sellSaving, setSellSaving] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  const markDraft = useFormDraft<MarkDraft>(MARK_DRAFT_KEY);
  const [markHydrated, setMarkHydrated] = useState(false);
  const sellDraft = useFormDraft<SellDraft>(SELL_DRAFT_KEY);
  const [sellHydrated, setSellHydrated] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, sm, inv] = await Promise.all([
        damagedApi.list(),
        damagedApi.summary(),
        api.listInventory(),
      ]);
      setItems(list);
      setSummary(sm);
      setInventory(inv);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ---- Restore an in-progress "mark as damaged" form once on mount ----
  useEffect(() => {
    if (markHydrated || markDraft.restoring) return;
    if (markDraft.restoredDraft?.markOpen) {
      setSelectedInv(markDraft.restoredDraft.selectedInv);
      setMarkQty(markDraft.restoredDraft.markQty);
      setMarkReason(markDraft.restoredDraft.markReason);
      setMarkOpen(true);
    }
    setMarkHydrated(true);
  }, [markDraft.restoring, markDraft.restoredDraft, markHydrated]);

  useEffect(() => {
    if (!markHydrated || !markOpen) return;
    markDraft.scheduleSave({ markOpen, selectedInv, markQty, markReason });
  }, [markHydrated, markOpen, selectedInv, markQty, markReason]);

  // ---- Restore an in-progress "sell damaged" form once on mount ----
  useEffect(() => {
    if (sellHydrated || sellDraft.restoring) return;
    if (sellDraft.restoredDraft?.sellOpen) {
      setSellTarget(sellDraft.restoredDraft.sellTarget);
      setSellPrice(sellDraft.restoredDraft.sellPrice);
      setSellNote(sellDraft.restoredDraft.sellNote);
      setSellOpen(true);
    }
    setSellHydrated(true);
  }, [sellDraft.restoring, sellDraft.restoredDraft, sellHydrated]);

  useEffect(() => {
    if (!sellHydrated || !sellOpen) return;
    sellDraft.scheduleSave({ sellOpen, sellTarget, sellPrice, sellNote });
  }, [sellHydrated, sellOpen, sellTarget, sellPrice, sellNote]);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    return items.filter((i) => i.status === tab);
  }, [items, tab]);

  const openMark = () => {
    setSelectedInv(null);
    setInvSearch("");
    setMarkQty("1");
    setMarkReason("");
    setMarkError(null);
    setMarkOpen(true);
  };

  const closeMark = () => {
    setMarkOpen(false);
    markDraft.clearDraft();
  };

  const closeSell = () => {
    setSellOpen(false);
    sellDraft.clearDraft();
  };

  const saveMark = async () => {
    setMarkError(null);
    if (!selectedInv) {
      setMarkError("Please select an item");
      return;
    }
    const q = parseInt(markQty || "0", 10);
    if (!q || q <= 0) {
      setMarkError("Quantity must be greater than 0");
      return;
    }
    if (q > selectedInv.current_qty) {
      setMarkError(`Only ${selectedInv.current_qty} in stock`);
      return;
    }
    if (!markReason.trim()) {
      setMarkError("Reason is required");
      return;
    }
    setMarkSaving(true);
    try {
      await damagedApi.markDamaged(selectedInv.id, q, markReason.trim());
      setMarkOpen(false);
      await markDraft.clearDraft();
      load();
    } catch (e: any) {
      setMarkError(e.message);
    } finally {
      setMarkSaving(false);
    }
  };

  const openSell = (d: DamagedItem) => {
    setSellTarget(d);
    setSellPrice(String(Math.max(0, Math.round((d.unit_price || 0) * d.qty * 0.5))));
    setSellNote("");
    setSellError(null);
    setSellOpen(true);
  };

  const saveSell = async () => {
    if (!sellTarget) return;
    setSellError(null);
    const p = parseInt(sellPrice || "0", 10);
    if (isNaN(p) || p < 0) {
      setSellError("Price must be 0 or more");
      return;
    }
    setSellSaving(true);
    try {
      await damagedApi.sellDamaged(sellTarget.id, p, sellNote.trim() || null);
      setSellOpen(false);
      await sellDraft.clearDraft();
      load();
    } catch (e: any) {
      setSellError(e.message);
    } finally {
      setSellSaving(false);
    }
  };

  const onDiscard = async (d: DamagedItem) => {
    try {
      await damagedApi.discardDamaged(d.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const filteredInventory = useMemo(() => {
    const s = invSearch.trim().toLowerCase();
    return inventory
      .filter((i) => i.current_qty > 0)
      .filter((i) => {
        if (!s) return true;
        return (
          i.item_name.toLowerCase().includes(s) ||
          i.item_id.toLowerCase().includes(s) ||
          i.category.toLowerCase().includes(s)
        );
      });
  }, [inventory, invSearch]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Damaged Items</Text>
          <Text style={styles.subtitle}>
            {summary
              ? `${summary.in_stock_count} in stock · ${summary.sold_count} sold`
              : "Loading..."}
          </Text>
        </View>
        <Pressable testID="add-damaged-button" onPress={openMark} style={styles.addBtn}>
          <Ionicons name="add" size={22} color={theme.color.onBrandPrimary} />
        </Pressable>
      </View>

      {/* Summary strip */}
      {summary && (
        <View style={styles.summaryStrip} testID="damaged-summary">
          <SumCell
            label="In Stock"
            value={String(summary.in_stock_qty)}
            icon="cube-outline"
          />
          <SumCell
            label="Sold Value"
            value={formatINRPlain(summary.sold_revenue)}
            icon="cash-outline"
          />
          <SumCell
            label="Loss @ cost"
            value={formatINRPlain(summary.loss_at_cost)}
            icon="alert-circle-outline"
            warn
          />
        </View>
      )}

      {/* Tabs */}
      <View style={styles.chipRowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                testID={`damaged-tab-${t.key}`}
                onPress={() => setTab(t.key)}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? theme.color.brandPrimary : theme.color.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active
                      ? theme.color.brandPrimary
                      : theme.color.onSurfaceSecondary,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={theme.color.brandPrimary}
            />
          }
          contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: theme.spacing.sm }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 48 }}>
              <Ionicons name="checkmark-done-outline" size={42} color={theme.color.onSurfaceTertiary} />
              <Text style={{ color: theme.color.onSurfaceTertiary, marginTop: 8 }}>
                No damaged items {tab === "all" ? "yet" : `in "${TABS.find((t) => t.key === tab)?.label}"`}
              </Text>
              {tab === "in_stock" && (
                <Text style={{ color: theme.color.onSurfaceTertiary, marginTop: 4, fontSize: 12 }}>
                  Tap + to mark an item as damaged
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => <DamagedRow item={item} onSell={openSell} onDiscard={onDiscard} />}
        />
      )}

      {error && (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
          <Text testID="damaged-error" style={styles.error}>
            {error}
          </Text>
        </View>
      )}

      {/* Mark damaged modal */}
      <Modal
        visible={markOpen}
        animationType="slide"
        transparent
        onRequestClose={closeMark}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <ScrollView
                contentContainerStyle={{ padding: theme.spacing.lg }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Mark as Damaged</Text>
                  <Pressable testID="close-mark-modal" onPress={closeMark}>
                    <Ionicons name="close" size={24} color={theme.color.onSurface} />
                  </Pressable>
                </View>

                {selectedInv ? (
                  <View style={styles.selectedInv} testID="selected-item">
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectedName}>{selectedInv.item_name}</Text>
                      <Text style={styles.selectedSub}>
                        {selectedInv.item_id} · {selectedInv.category} · {formatINRPlain(selectedInv.price)}
                      </Text>
                      <Text style={styles.selectedSub}>
                        Stock: {selectedInv.current_qty}
                      </Text>
                    </View>
                    <Pressable
                      testID="change-item"
                      onPress={() => setSelectedInv(null)}
                      style={styles.changeBtn}
                    >
                      <Text style={styles.changeBtnText}>Change</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Select Item</Text>
                    <View style={styles.searchBar}>
                      <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
                      <TextInput
                        testID="mark-search"
                        value={invSearch}
                        onChangeText={setInvSearch}
                        placeholder="Search items in stock"
                        placeholderTextColor={theme.color.onSurfaceTertiary}
                        style={styles.searchInput}
                      />
                    </View>
                    <View style={styles.invList} testID="mark-inv-list">
                      {filteredInventory.slice(0, 12).map((i) => (
                        <Pressable
                          key={i.id}
                          testID={`pick-inv-${i.item_id}`}
                          onPress={() => setSelectedInv(i)}
                          style={styles.invRow}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.invName}>{i.item_name}</Text>
                            <Text style={styles.invSub}>
                              {i.item_id} · Qty {i.current_qty} · {formatINRPlain(i.price)}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={theme.color.onSurfaceTertiary} />
                        </Pressable>
                      ))}
                      {filteredInventory.length === 0 && (
                        <Text
                          style={{
                            color: theme.color.onSurfaceTertiary,
                            padding: theme.spacing.md,
                          }}
                        >
                          No items available.
                        </Text>
                      )}
                    </View>
                  </>
                )}

                {selectedInv && (
                  <>
                    <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Damaged Quantity</Text>
                    <TextInput
                      testID="mark-qty"
                      value={markQty}
                      onChangeText={setMarkQty}
                      keyboardType="number-pad"
                      placeholder="1"
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.input}
                    />

                    <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Reason / Notes</Text>
                    <TextInput
                      testID="mark-reason"
                      value={markReason}
                      onChangeText={setMarkReason}
                      placeholder="e.g. Chipped stone, transit damage"
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={[styles.input, { minHeight: 72 }]}
                      multiline
                    />
                  </>
                )}

                {markError && (
                  <Text testID="mark-error" style={[styles.error, { marginTop: theme.spacing.md }]}>
                    {markError}
                  </Text>
                )}

                <Pressable
                  testID="save-mark"
                  onPress={saveMark}
                  disabled={markSaving || !selectedInv}
                  style={[styles.saveBtn, (markSaving || !selectedInv) && { opacity: 0.5 }]}
                >
                  {markSaving ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <Text style={styles.saveText}>Mark & Deduct Stock</Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sell damaged modal */}
      <Modal
        visible={sellOpen}
        animationType="slide"
        transparent
        onRequestClose={closeSell}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <ScrollView
                contentContainerStyle={{ padding: theme.spacing.lg }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Sell Damaged Item</Text>
                  <Pressable testID="close-sell-modal" onPress={closeSell}>
                    <Ionicons name="close" size={24} color={theme.color.onSurface} />
                  </Pressable>
                </View>

                {sellTarget && (
                  <>
                    <View style={styles.selectedInv}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedName}>{sellTarget.item_name}</Text>
                        <Text style={styles.selectedSub}>
                          Qty {sellTarget.qty} · Reg. {formatINRPlain(sellTarget.unit_price)}
                        </Text>
                        <Text style={styles.selectedSub}>Reason: {sellTarget.reason}</Text>
                      </View>
                    </View>

                    <Text style={[styles.label, { marginTop: theme.spacing.md }]}>
                      Sale Price (₹) — total received
                    </Text>
                    <TextInput
                      testID="sell-price"
                      value={sellPrice}
                      onChangeText={(v) => setSellPrice(v.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.input}
                    />

                    <Text style={[styles.label, { marginTop: theme.spacing.md }]}>
                      Note (optional)
                    </Text>
                    <TextInput
                      testID="sell-note"
                      value={sellNote}
                      onChangeText={setSellNote}
                      placeholder="Buyer, offer notes, etc."
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.input}
                    />
                  </>
                )}

                {sellError && (
                  <Text testID="sell-error" style={[styles.error, { marginTop: theme.spacing.md }]}>
                    {sellError}
                  </Text>
                )}

                <Pressable
                  testID="save-sell"
                  onPress={saveSell}
                  disabled={sellSaving}
                  style={[styles.saveBtn, sellSaving && { opacity: 0.5 }]}
                >
                  {sellSaving ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <Text style={styles.saveText}>Confirm Sale</Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function SumCell({
  label,
  value,
  icon,
  warn,
}: {
  label: string;
  value: string;
  icon: any;
  warn?: boolean;
}) {
  return (
    <View style={styles.sumCell}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons
          name={icon}
          size={14}
          color={warn ? theme.color.error : theme.color.brandPrimary}
        />
        <Text style={styles.sumLabel}>{label}</Text>
      </View>
      <Text style={[styles.sumValue, warn && { color: theme.color.error }]}>{value}</Text>
    </View>
  );
}

function DamagedRow({
  item,
  onSell,
  onDiscard,
}: {
  item: DamagedItem;
  onSell: (d: DamagedItem) => void;
  onDiscard: (d: DamagedItem) => void;
}) {
  const statusColor =
    item.status === "sold"
      ? theme.color.success
      : item.status === "discarded"
      ? theme.color.onSurfaceTertiary
      : theme.color.warning;
  return (
    <View style={styles.row} testID={`damaged-row-${item.id}`}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={styles.rowName}>{item.item_name}</Text>
          <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
            <Text style={styles.statusPillText}>{item.status.replace("_", " ").toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.rowSub}>
          Qty {item.qty} · Reg. {formatINRPlain(item.unit_price)}
          {item.category ? ` · ${item.category}` : ""}
        </Text>
        <Text style={styles.rowReason} numberOfLines={2}>
          {item.reason}
        </Text>
        {item.status === "sold" && item.sold_price != null && (
          <Text style={styles.rowSold} testID={`sold-price-${item.id}`}>
            Sold for {formatINRPlain(item.sold_price)}
            {item.sold_note ? ` · ${item.sold_note}` : ""}
          </Text>
        )}
      </View>
      {item.status === "in_stock" && (
        <View style={{ gap: 6 }}>
          <Pressable
            testID={`sell-btn-${item.id}`}
            onPress={() => onSell(item)}
            style={styles.actionBtn}
          >
            <Ionicons name="cash-outline" size={14} color={theme.color.onBrandPrimary} />
            <Text style={styles.actionBtnText}>Sell</Text>
          </Pressable>
          <Pressable
            testID={`discard-btn-${item.id}`}
            onPress={() => onDiscard(item)}
            style={[styles.actionBtn, { backgroundColor: theme.color.surfaceTertiary }]}
          >
            <Ionicons name="trash-outline" size={14} color={theme.color.onSurface} />
            <Text style={[styles.actionBtnText, { color: theme.color.onSurface }]}>Discard</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  subtitle: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryStrip: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  sumCell: {
    flex: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  sumLabel: { color: theme.color.onSurfaceTertiary, fontSize: 11, fontWeight: "600" },
  sumValue: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700", marginTop: 6 },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRow: { paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: "center" },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  rowName: { color: theme.color.onSurface, fontWeight: "700", fontSize: 15 },
  rowSub: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 4 },
  rowReason: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    marginTop: 4,
    fontStyle: "italic",
  },
  rowSold: {
    color: theme.color.success,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  statusPillText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: theme.color.brandPrimary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    minWidth: 78,
  },
  actionBtnText: {
    color: theme.color.onBrandPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: theme.color.surface,
    maxHeight: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopColor: theme.color.brandPrimary,
    borderTopWidth: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  label: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
    color: theme.color.onSurface,
    fontSize: 16,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 12, color: theme.color.onSurface, fontSize: 15 },
  invList: {
    marginTop: theme.spacing.md,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    overflow: "hidden",
  },
  invRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.md,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
    gap: 8,
  },
  invName: { color: theme.color.onSurface, fontWeight: "600", fontSize: 14 },
  invSub: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  selectedInv: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  selectedName: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 15 },
  selectedSub: { color: theme.color.onBrandTertiary, fontSize: 12, marginTop: 3 },
  changeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
  },
  changeBtnText: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  error: { color: theme.color.error, fontSize: 13 },
  saveBtn: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  saveText: { color: theme.color.onBrandPrimary, fontWeight: "800", fontSize: 16 },
});
