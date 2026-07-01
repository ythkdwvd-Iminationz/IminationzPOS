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
import { api, Bill } from "@/src/api/client";
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

  useFocusEffect(
    useCallback(() => {
      // Employees are locked to today.
      const f = isEmployee ? "today" : filter;
      load(f, isEmployee ? "" : search, start, end);
    }, [load, filter, search, start, end, isEmployee])
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
                  <Text style={styles.meta}>
                    Mobile: {item.customer_mobile || "—"} · Cash{" "}
                    {formatINRPlain(item.cash_amount)} · UPI{" "}
                    {formatINRPlain(item.upi_amount)}
                  </Text>
                )}
              </View>
              {!isEmployee && (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.amount}>
                    {formatINRPlain(item.final_amount)}
                  </Text>
                  {item.discount > 0 && (
                    <Text style={styles.discount}>
                      -{formatINRPlain(item.discount)} off
                    </Text>
                  )}
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
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  statusText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  amount: { color: theme.color.brandPrimary, fontSize: 16, fontWeight: "800" },
  discount: { color: theme.color.warning, fontSize: 11, marginTop: 2 },

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
