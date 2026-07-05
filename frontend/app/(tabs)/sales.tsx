import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, Bill, InventoryItem } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";
import { useRole } from "@/src/hooks/use-role";

const OWNER_FILTERS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "month", label: "Month" },
  { id: "custom", label: "Custom" },
  { id: "all", label: "All" },
];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Current month: 1st -> today
const currentMonthRange = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const to = todayISO();
  return { from, to };
};

// Last month: 1st -> last day of previous month
const lastMonthRange = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed, current month
  const prevMonthDate = new Date(y, m - 1, 1);
  const py = prevMonthDate.getFullYear();
  const pm = prevMonthDate.getMonth();
  const from = `${py}-${String(pm + 1).padStart(2, "0")}-01`;
  // Last day of previous month = day 0 of current month
  const lastDay = new Date(y, m, 0);
  const to = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
  return { from, to };
};

export default function SalesScreen() {
  const router = useRouter();
  const { role } = useRole();
  const isEmployee = role === "employee";

  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>(isEmployee ? "today" : "today");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState<string>(todayISO());
  const [end, setEnd] = useState<string>(todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);

  // ---- Exchange feature (owner only) ----
  const [exchangeBill, setExchangeBill] = useState<Bill | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  // Owner-only month revenue summary
  const [monthSummary, setMonthSummary] = useState<{
    currentMonthRevenue: number;
    lastMonthRevenue: number;
    lastMonthOnePct: number;
  } | null>(null);
  const [monthSummaryLoading, setMonthSummaryLoading] = useState(false);

  const load = useCallback(
    async (f: string, s: string, sd: string, ed: string) => {
      setLoading(true);
      try {
        const res = await api.listBills({
          filter: f,
          search: s || undefined,
          start_date: sd,
          end_date: ed,
        });
        setBills(res);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const openExchange = useCallback(async (bill: Bill) => {
    setExchangeBill(bill);
    // Lazily load inventory only when the exchange modal is actually
    // opened, so owners who never use this feature don't pay the cost
    // of an extra fetch on every Sales screen visit.
    try {
      const inv = await api.listInventory();
      setInventory(inv);
    } catch {
      // If this fails, the exchange modal will just show an empty
      // "new item" list — the picker itself surfaces that state.
    }
  }, []);

  const loadMonthSummary = useCallback(async () => {
    setMonthSummaryLoading(true);
    try {
      const cur = currentMonthRange();
      const last = lastMonthRange();
      const [curBills, lastBills] = await Promise.all([
        api.listBills({ filter: "custom", start_date: cur.from, end_date: cur.to }),
        api.listBills({ filter: "custom", start_date: last.from, end_date: last.to }),
      ]);
      const currentMonthRevenue = curBills.reduce((s, b) => s + Number(b.final_amount), 0);
      const lastMonthRevenue = lastBills.reduce((s, b) => s + Number(b.final_amount), 0);
      setMonthSummary({
        currentMonthRevenue,
        lastMonthRevenue,
        lastMonthOnePct: lastMonthRevenue * 0.01,
      });
    } catch {
      setMonthSummary(null);
    } finally {
      setMonthSummaryLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Employees are locked to today.
      const f = isEmployee ? "today" : filter;
      load(f, isEmployee ? "" : search, start, end);
      if (!isEmployee) {
        loadMonthSummary();
      }
    }, [load, filter, search, start, end, isEmployee, loadMonthSummary])
  );

  const totals = bills.reduce(
    (acc, b) => {
      acc.sales += b.final_amount;
      acc.cash += b.cash_amount;
      acc.upi += b.upi_amount;
      return acc;
    },
    { sales: 0, cash: 0, upi: 0 }
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {isEmployee ? "Today's Sales" : "Sales History"}
        </Text>
        <Text style={styles.subtitle}>
          {isEmployee
            ? `${bills.length} bills`
            : `${bills.length} bills · ${formatINRPlain(totals.sales)}`}
        </Text>
      </View>

      {!isEmployee && (
        <>
          {/* Month revenue summary card — owner only */}
          <View style={styles.monthSummaryCard} testID="sales-month-summary">
            <View style={styles.monthSummaryHeader}>
              <Ionicons name="bar-chart" size={15} color={theme.color.brandPrimary} />
              <Text style={styles.monthSummaryTitle}>Monthly Revenue</Text>
              {monthSummaryLoading && (
                <ActivityIndicator size="small" color={theme.color.brandPrimary} style={{ marginLeft: 6 }} />
              )}
            </View>

            {monthSummary ? (
              <>
                <View style={styles.monthSummaryRow}>
                  <View style={styles.monthSummaryCol}>
                    <Text style={styles.monthSummaryLabel}>This Month (1st → Today)</Text>
                    <Text
                      testID="sales-current-month-revenue"
                      style={styles.monthSummaryValue}
                    >
                      {formatINRPlain(monthSummary.currentMonthRevenue)}
                    </Text>
                  </View>
                  <View style={styles.monthSummaryDivider} />
                  <View style={styles.monthSummaryCol}>
                    <Text style={styles.monthSummaryLabel}>Last Month (Full)</Text>
                    <Text
                      testID="sales-last-month-revenue"
                      style={styles.monthSummaryValue}
                    >
                      {formatINRPlain(monthSummary.lastMonthRevenue)}
                    </Text>
                  </View>
                </View>
                <View style={styles.onePctBox}>
                  <Text style={styles.onePctLabel}>1% of Last Month's Revenue</Text>
                  <Text testID="sales-last-month-one-pct" style={styles.onePctValue}>
                    {formatINRPlain(monthSummary.lastMonthOnePct)}
                  </Text>
                </View>
              </>
            ) : monthSummaryLoading ? null : (
              <Text style={styles.monthSummaryError}>Couldn't load monthly revenue</Text>
            )}
          </View>

          <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
              <TextInput
                testID="sales-search"
                value={search}
                onChangeText={setSearch}
                placeholder="Search bill no or mobile"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={styles.searchInput}
              />
            </View>
          </View>

          <View style={styles.chipRowWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {OWNER_FILTERS.map((f) => {
                const active = f.id === filter;
                return (
                  <Pressable
                    key={f.id}
                    testID={`filter-${f.id}`}
                    onPress={() => {
                      setFilter(f.id);
                      if (f.id === "custom") setPickerOpen(true);
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: active
                          ? theme.color.brandPrimary
                          : theme.color.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: active
                          ? theme.color.brandPrimary
                          : theme.color.onSurfaceSecondary,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {filter === "custom" && (
            <View style={styles.rangeChip} testID="sales-range-chip">
              <Ionicons name="calendar" size={14} color={theme.color.brandPrimary} />
              <Text style={styles.rangeText}>
                {start} → {end}
              </Text>
              <Pressable
                testID="sales-range-edit"
                onPress={() => setPickerOpen(true)}
                style={styles.rangeEdit}
              >
                <Ionicons name="create-outline" size={14} color={theme.color.brandPrimary} />
              </Pressable>
            </View>
          )}
        </>
      )}

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: theme.spacing.sm }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 48 }}>
              <Ionicons
                name="receipt-outline"
                size={42}
                color={theme.color.onSurfaceTertiary}
              />
              <Text style={{ color: theme.color.onSurfaceTertiary, marginTop: 8 }}>
                No bills found
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`bill-row-${item.bill_number}`}
              onPress={() =>
                isEmployee ? null : router.push(`/invoice/${item.id}`)
              }
              style={styles.row}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.billNo}>{item.bill_number}</Text>
                  {!isEmployee && (
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            item.payment_status === "PAID"
                              ? theme.color.success
                              : theme.color.error,
                        },
                      ]}
                    >
                      <Text style={styles.statusText}>{item.payment_status}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.meta}>
                  {item.date} · {item.day} · {item.time}
                </Text>
                {isEmployee ? (
                  <Text style={styles.meta}>
                    Mobile: {item.customer_mobile || "—"}
                    {item.customer_name ? ` · ${item.customer_name}` : ""}
                  </Text>
                ) : (
                  <>
                    <Text style={styles.meta}>
                      Mobile: {item.customer_mobile || "—"} · Cash{" "}
                      {formatINRPlain(item.cash_amount)} · UPI{" "}
                      {formatINRPlain(item.upi_amount)}
                    </Text>
                    {item.created_by_role && (
                      <View style={styles.creatorRow} testID={`bill-creator-${item.bill_number}`}>
                        <View
                          style={[
                            styles.creatorDot,
                            {
                              backgroundColor:
                                item.created_by_role === "owner"
                                  ? theme.color.brandPrimary
                                  : theme.color.info,
                            },
                          ]}
                        />
                        <Text style={styles.creatorText}>
                          {item.created_by_role === "owner" ? "Owner" : "Employee"}
                          {item.created_by_email ? ` · ${item.created_by_email}` : ""}
                        </Text>
                      </View>
                    )}
                    {(item.exchange_count || 0) > 0 && (
                      <View style={styles.exchangedBadge} testID={`bill-exchanged-${item.bill_number}`}>
                        <Ionicons name="swap-horizontal" size={11} color={theme.color.warning} />
                        <Text style={styles.exchangedBadgeText}>
                          Exchanged {item.exchange_count}x
                          {item.exchanged_at
                            ? ` · last ${new Date(item.exchanged_at).toLocaleDateString("en-IN")}`
                            : ""}
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </View>
              {!isEmployee && (
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <Text style={styles.amount}>
                    {formatINRPlain(item.final_amount)}
                  </Text>
                  {item.discount > 0 && (
                    <Text style={styles.discount}>
                      -{formatINRPlain(item.discount)} off
                    </Text>
                  )}
                  <Pressable
                    testID={`exchange-button-${item.bill_number}`}
                    onPress={(e) => {
                      e.stopPropagation();
                      openExchange(item);
                    }}
                    style={styles.exchangeBtn}
                    hitSlop={6}
                  >
                    <Ionicons name="swap-horizontal" size={13} color={theme.color.brandPrimary} />
                    <Text style={styles.exchangeBtnText}>Exchange</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          )}
        />
      )}

      <DateRangeModal
        visible={pickerOpen}
        start={start}
        end={end}
        onCancel={() => setPickerOpen(false)}
        onApply={(s, e) => {
          setStart(s);
          setEnd(e);
          setPickerOpen(false);
        }}
      />

      <ExchangeModal
        bill={exchangeBill}
        inventory={inventory}
        onClose={() => setExchangeBill(null)}
        onComplete={() => {
          setExchangeBill(null);
          load(isEmployee ? "today" : filter, isEmployee ? "" : search, start, end);
        }}
      />
    </SafeAreaView>
  );
}

/* ------------- Date range modal ------------- */

export function DateRangeModal({
  visible,
  start,
  end,
  onCancel,
  onApply,
}: {
  visible: boolean;
  start: string;
  end: string;
  onCancel: () => void;
  onApply: (start: string, end: string) => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);

  const shift = (which: "s" | "e", delta: number) => {
    const cur = which === "s" ? s : e;
    const d = new Date(cur + "T00:00:00");
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + delta);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (which === "s") setS(v);
    else setE(v);
  };

  const invalid = !s || !e || s > e;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.rangeOverlay}>
        <View style={styles.rangeBox}>
          <Text style={styles.rangeTitle}>Custom date range</Text>

          <Text style={styles.rangeLabel}>From</Text>
          <View style={styles.rangeInputRow}>
            <Pressable testID="range-start-minus" onPress={() => shift("s", -1)} style={styles.rangeStep}>
              <Text style={styles.rangeStepText}>-1d</Text>
            </Pressable>
            <TextInput
              testID="range-start-input"
              value={s}
              onChangeText={setS}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.rangeInput, { flex: 1 }]}
            />
            <Pressable testID="range-start-plus" onPress={() => shift("s", 1)} style={styles.rangeStep}>
              <Text style={styles.rangeStepText}>+1d</Text>
            </Pressable>
          </View>

          <Text style={styles.rangeLabel}>To</Text>
          <View style={styles.rangeInputRow}>
            <Pressable testID="range-end-minus" onPress={() => shift("e", -1)} style={styles.rangeStep}>
              <Text style={styles.rangeStepText}>-1d</Text>
            </Pressable>
            <TextInput
              testID="range-end-input"
              value={e}
              onChangeText={setE}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.rangeInput, { flex: 1 }]}
            />
            <Pressable testID="range-end-plus" onPress={() => shift("e", 1)} style={styles.rangeStep}>
              <Text style={styles.rangeStepText}>+1d</Text>
            </Pressable>
          </View>

          {invalid && (
            <Text style={styles.rangeWarn}>Start date must be on or before end date.</Text>
          )}

          <View style={styles.rangeBtns}>
            <Pressable
              testID="range-cancel"
              onPress={onCancel}
              style={[styles.rangeBtn, { backgroundColor: theme.color.surfaceTertiary }]}
            >
              <Text style={styles.rangeBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="range-apply"
              disabled={invalid}
              onPress={() => onApply(s, e)}
              style={[
                styles.rangeBtn,
                { backgroundColor: theme.color.brandPrimary, opacity: invalid ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.rangeBtnText, { color: theme.color.onBrandPrimary }]}>
                Apply
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ------------- Exchange modal ------------- */

function ExchangeModal({
  bill,
  inventory,
  onClose,
  onComplete,
}: {
  bill: Bill | null;
  inventory: InventoryItem[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<"pick-old" | "pick-new" | "settle">("pick-old");
  const [oldLine, setOldLine] = useState<Bill["items"][number] | null>(null);
  const [newItem, setNewItem] = useState<InventoryItem | null>(null);
  const [newQty, setNewQty] = useState("1");
  const [search, setSearch] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetAll = () => {
    setStep("pick-old");
    setOldLine(null);
    setNewItem(null);
    setNewQty("1");
    setSearch("");
    setCashAmount("");
    setUpiAmount("");
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  if (!bill) return null;

  const qtyNum = parseInt(newQty || "0", 10) || 0;
  const oldLineTotal = oldLine ? oldLine.price * oldLine.qty : 0;
  const newLineTotal = newItem ? newItem.price * qtyNum : 0;
  const priceDiff = newLineTotal - oldLineTotal;

  // Auto-fill settlement the same way the billing screen does: typing
  // one field fills the other with the remainder needed to cover the
  // difference, but either can still be overtyped freely.
  const onCashChange = (val: string) => {
    setCashAmount(val);
    const c = parseFloat(val || "0") || 0;
    const remainder = Math.round((priceDiff - c) * 100) / 100;
    setUpiAmount(remainder === 0 ? "0" : String(remainder));
  };
  const onUpiChange = (val: string) => {
    setUpiAmount(val);
    const u = parseFloat(val || "0") || 0;
    const remainder = Math.round((priceDiff - u) * 100) / 100;
    setCashAmount(remainder === 0 ? "0" : String(remainder));
  };

  const settlement =
    (parseFloat(cashAmount || "0") || 0) + (parseFloat(upiAmount || "0") || 0);
  const settlementMatches = Math.abs(settlement - priceDiff) < 0.01;

  const filteredInventory = inventory.filter((i) => {
    if (i.current_qty <= 0 && i.id !== oldLine?.inv_id) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      i.item_name.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q) ||
      i.item_id.toLowerCase().includes(q)
    );
  });

  const onComplete_ = async () => {
    if (!oldLine || !newItem) return;
    if (qtyNum <= 0) {
      setError("Enter a valid quantity");
      return;
    }
    if (!settlementMatches) {
      setError(
        `Cash + UPI (${formatINRPlain(settlement)}) must equal the price difference (${formatINRPlain(priceDiff)})`
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.exchangeBillItem({
        bill_id: bill.id,
        old_bill_item_id: oldLine.id,
        new_inv_id: newItem.id,
        new_qty: qtyNum,
        cash_amount: parseFloat(cashAmount || "0") || 0,
        upi_amount: parseFloat(upiAmount || "0") || 0,
      });
      resetAll();
      onComplete();
    } catch (e: any) {
      setError(e.message || "Exchange failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={!!bill} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.exchangeOverlay}>
        <View style={styles.exchangeSheet}>
          <View style={styles.exchangeHeader}>
            <Text style={styles.exchangeTitle}>Exchange Item</Text>
            <Pressable testID="exchange-close" onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>
          <Text style={styles.exchangeSubtitle}>Bill {bill.bill_number}</Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {step === "pick-old" && (
              <>
                <Text style={styles.exchangeSectionLabel}>Which item is being returned?</Text>
                {bill.items.map((line) => (
                  <Pressable
                    key={line.id}
                    testID={`exchange-pick-old-${line.item_id}`}
                    onPress={() => {
                      setOldLine(line);
                      setStep("pick-new");
                    }}
                    style={styles.exchangeLineRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.exchangeLineName}>{line.item_name}</Text>
                      <Text style={styles.exchangeLineSub}>
                        Qty {line.qty} · {formatINRPlain(line.price)} each
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.color.onSurfaceTertiary} />
                  </Pressable>
                ))}
              </>
            )}

            {step === "pick-new" && oldLine && (
              <>
                <View style={styles.exchangeArrowRow}>
                  <View style={styles.exchangeSideCard}>
                    <Text style={styles.exchangeSideLabel}>Returning</Text>
                    <Text style={styles.exchangeSideName} numberOfLines={2}>
                      {oldLine.item_name}
                    </Text>
                    <Text style={styles.exchangeSidePrice}>{formatINRPlain(oldLineTotal)}</Text>
                  </View>
                  <Ionicons name="swap-horizontal" size={22} color={theme.color.brandPrimary} />
                  <View style={styles.exchangeSideCard}>
                    <Text style={styles.exchangeSideLabel}>New Item</Text>
                    <Text style={styles.exchangeSideNamePlaceholder}>Select below</Text>
                  </View>
                </View>

                <TextInput
                  testID="exchange-search"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search item to give instead"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={styles.exchangeSearch}
                />

                <FlatList
                  data={filteredInventory}
                  keyExtractor={(i) => i.id}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <Pressable
                      testID={`exchange-pick-new-${item.item_id}`}
                      onPress={() => {
                        setNewItem(item);
                        setStep("settle");
                      }}
                      style={styles.exchangeLineRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.exchangeLineName}>{item.item_name}</Text>
                        <Text style={styles.exchangeLineSub}>
                          {item.category} · {formatINRPlain(item.price)} · stock {item.current_qty}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.color.onSurfaceTertiary} />
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.exchangeEmpty}>No items found</Text>
                  }
                />
              </>
            )}

            {step === "settle" && oldLine && newItem && (
              <>
                <View style={styles.exchangeArrowRow}>
                  <View style={styles.exchangeSideCard}>
                    <Text style={styles.exchangeSideLabel}>Returning</Text>
                    <Text style={styles.exchangeSideName} numberOfLines={2}>
                      {oldLine.item_name}
                    </Text>
                    <Text style={styles.exchangeSidePrice}>{formatINRPlain(oldLineTotal)}</Text>
                  </View>
                  <Ionicons name="swap-horizontal" size={22} color={theme.color.brandPrimary} />
                  <View style={styles.exchangeSideCard}>
                    <Text style={styles.exchangeSideLabel}>New Item</Text>
                    <Text style={styles.exchangeSideName} numberOfLines={2}>
                      {newItem.item_name}
                    </Text>
                    <Text style={styles.exchangeSidePrice}>{formatINRPlain(newLineTotal)}</Text>
                  </View>
                </View>

                <Pressable
                  testID="exchange-change-new-item"
                  onPress={() => setStep("pick-new")}
                  style={styles.exchangeChangeLink}
                >
                  <Text style={styles.exchangeChangeLinkText}>Change new item</Text>
                </Pressable>

                <Text style={[styles.exchangeSectionLabel, { marginTop: theme.spacing.lg }]}>
                  Quantity of new item
                </Text>
                <TextInput
                  testID="exchange-new-qty"
                  value={newQty}
                  onChangeText={setNewQty}
                  keyboardType="number-pad"
                  style={styles.exchangeSearch}
                />

                <View style={styles.exchangeDiffBox}>
                  <Text style={styles.exchangeDiffLabel}>Price Difference</Text>
                  <Text
                    testID="exchange-price-diff"
                    style={[
                      styles.exchangeDiffValue,
                      { color: priceDiff >= 0 ? theme.color.error : theme.color.success },
                    ]}
                  >
                    {priceDiff >= 0
                      ? `Customer pays ${formatINRPlain(priceDiff)}`
                      : `Refund ${formatINRPlain(-priceDiff)}`}
                  </Text>
                </View>

                <Text style={styles.exchangeSectionLabel}>Settle via</Text>
                <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exchangeFieldLabel}>Cash</Text>
                    <TextInput
                      testID="exchange-cash-input"
                      value={cashAmount}
                      onChangeText={onCashChange}
                      keyboardType="numbers-and-punctuation"
                      placeholder="0"
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.exchangeSearch}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exchangeFieldLabel}>UPI</Text>
                    <TextInput
                      testID="exchange-upi-input"
                      value={upiAmount}
                      onChangeText={onUpiChange}
                      keyboardType="numbers-and-punctuation"
                      placeholder="0"
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.exchangeSearch}
                    />
                  </View>
                </View>

                {error && (
                  <Text testID="exchange-error" style={styles.exchangeError}>
                    {error}
                  </Text>
                )}

                <Pressable
                  testID="exchange-complete"
                  onPress={onComplete_}
                  disabled={submitting || qtyNum <= 0}
                  style={[
                    styles.exchangeCompleteBtn,
                    (submitting || qtyNum <= 0) && { opacity: 0.5 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <Text style={styles.exchangeCompleteBtnText}>Complete Exchange</Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700" },
  subtitle: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
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
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  billNo: { color: theme.color.onSurface, fontWeight: "700", fontSize: 14 },
  meta: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  creatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  creatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  creatorText: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 10,
    fontWeight: "600",
  },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  statusText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  amount: { color: theme.color.brandPrimary, fontSize: 16, fontWeight: "800" },
  discount: { color: theme.color.warning, fontSize: 11, marginTop: 2 },
  exchangedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  exchangedBadgeText: {
    color: theme.color.warning,
    fontSize: 10,
    fontWeight: "700",
  },
  exchangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  exchangeBtnText: {
    color: theme.color.brandPrimary,
    fontSize: 11,
    fontWeight: "700",
  },

  /* Exchange modal */
  exchangeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  exchangeSheet: {
    backgroundColor: theme.color.surface,
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopColor: theme.color.brandPrimary,
    borderTopWidth: 1,
    padding: theme.spacing.lg,
  },
  exchangeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  exchangeTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  exchangeSubtitle: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 12,
    marginTop: 2,
    marginBottom: theme.spacing.md,
  },
  exchangeSectionLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  exchangeLineRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  exchangeLineName: { color: theme.color.onSurface, fontWeight: "600", fontSize: 14 },
  exchangeLineSub: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  exchangeArrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  exchangeSideCard: {
    flex: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    minHeight: 80,
  },
  exchangeSideLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  exchangeSideName: {
    color: theme.color.onSurface,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 6,
  },
  exchangeSideNamePlaceholder: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 6,
  },
  exchangeSidePrice: {
    color: theme.color.brandPrimary,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 6,
  },
  exchangeChangeLink: { alignSelf: "flex-start", marginBottom: theme.spacing.sm },
  exchangeChangeLinkText: {
    color: theme.color.brandPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  exchangeSearch: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    color: theme.color.onSurface,
    fontSize: 15,
    marginBottom: theme.spacing.md,
  },
  exchangeEmpty: {
    color: theme.color.onSurfaceTertiary,
    textAlign: "center",
    marginTop: theme.spacing.lg,
  },
  exchangeDiffBox: {
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    alignItems: "center",
  },
  exchangeDiffLabel: {
    color: theme.color.onBrandTertiary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  exchangeDiffValue: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 4,
  },
  exchangeFieldLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  exchangeError: {
    color: theme.color.error,
    fontSize: 12,
    marginBottom: theme.spacing.md,
  },
  exchangeCompleteBtn: {
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 16,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: theme.spacing.sm,
  },
  exchangeCompleteBtnText: {
    color: theme.color.onBrandPrimary,
    fontWeight: "800",
    fontSize: 15,
  },

  /* Month revenue summary card */
  monthSummaryCard: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  monthSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: theme.spacing.md,
  },
  monthSummaryTitle: {
    color: theme.color.onSurface,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  monthSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  monthSummaryCol: { flex: 1 },
  monthSummaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: theme.color.divider,
    marginHorizontal: theme.spacing.md,
  },
  monthSummaryLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  monthSummaryValue: {
    color: theme.color.brandPrimary,
    fontSize: 19,
    fontWeight: "800",
  },
  onePctBox: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopColor: theme.color.divider,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  onePctLabel: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  onePctValue: {
    color: theme.color.warning,
    fontSize: 15,
    fontWeight: "800",
  },
  monthSummaryError: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 12,
  },

  rangeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginHorizontal: theme.spacing.lg,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
    backgroundColor: theme.color.brandTertiary,
  },
  rangeText: { color: theme.color.onBrandTertiary, fontSize: 12, fontWeight: "600" },
  rangeEdit: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surface,
  },

  rangeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  rangeBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderColor: theme.color.border,
    borderWidth: 1,
    padding: theme.spacing.xl,
  },
  rangeTitle: {
    color: theme.color.onSurface,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  rangeLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  rangeInputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rangeInput: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    color: theme.color.onSurface,
    fontSize: 15,
    textAlign: "center",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  rangeStep: {
    height: 46,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rangeStepText: { color: theme.color.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  rangeWarn: { color: theme.color.warning, fontSize: 12, marginTop: 8 },
  rangeBtns: { flexDirection: "row", gap: 10, marginTop: theme.spacing.lg },
  rangeBtn: {
    flex: 1,
    height: 46,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rangeBtnText: { color: theme.color.onSurface, fontWeight: "700" },
});
