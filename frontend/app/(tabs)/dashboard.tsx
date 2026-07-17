import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, clearToken, DashboardData } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";
import { useRole } from "@/src/hooks/use-role";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shiftISO = (iso: string, delta: number): string => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const humanDate = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export default function DashboardScreen() {
  const router = useRouter();
  const { role } = useRole();
  const isEmployee = role === "employee";
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owner-only: view dashboard for any date. Employees always see today.
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const isToday = selectedDate === todayISO();

  const load = useCallback(
    async (dateOverride?: string) => {
      try {
        setError(null);
        const target = isEmployee ? undefined : (dateOverride ?? selectedDate);
        const res = await api.dashboard(target);
        setData(res);
      } catch (e: any) {
        if (e?.message?.includes("token")) {
          await clearToken();
          router.replace("/");
          return;
        }
        setError(e.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, isEmployee, selectedDate]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onLogout = async () => {
    await clearToken();
    router.replace("/");
  };

  const onSeed = async () => {
    try {
      await api.seed();
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>{data?.store_name || "Iminationz"}</Text>
          <Text style={styles.subtitle}>
            {isEmployee
              ? `Today's overview · ${data?.date || ""}`
              : isToday
                ? `Today's overview · ${data?.date || ""}`
                : `Selected day · ${data?.date || selectedDate}`}
          </Text>
        </View>
        <Pressable testID="logout-button" onPress={onLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={theme.color.onSurface} />
        </Pressable>
      </View>

      {!isEmployee && (
        <View style={styles.dateBar} testID="dashboard-date-bar">
          <Pressable
            testID="dashboard-date-prev"
            onPress={() => {
              const next = shiftISO(selectedDate, -1);
              setSelectedDate(next);
              setLoading(true);
              load(next);
            }}
            style={styles.dateArrow}
            hitSlop={6}
          >
            <Ionicons name="chevron-back" size={18} color={theme.color.brandPrimary} />
          </Pressable>

          <Pressable
            testID="dashboard-date-pill"
            onPress={() => setDatePickerOpen(true)}
            style={styles.datePill}
          >
            <Ionicons name="calendar" size={14} color={theme.color.brandPrimary} />
            <Text style={styles.datePillText} numberOfLines={1}>
              {humanDate(selectedDate)}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.color.brandPrimary} />
          </Pressable>

          <Pressable
            testID="dashboard-date-next"
            onPress={() => {
              const next = shiftISO(selectedDate, 1);
              // Don't allow future dates — no data there anyway.
              if (next > todayISO()) return;
              setSelectedDate(next);
              setLoading(true);
              load(next);
            }}
            disabled={selectedDate >= todayISO()}
            style={[styles.dateArrow, selectedDate >= todayISO() && { opacity: 0.4 }]}
            hitSlop={6}
          >
            <Ionicons name="chevron-forward" size={18} color={theme.color.brandPrimary} />
          </Pressable>

          {!isToday && (
            <Pressable
              testID="dashboard-date-reset"
              onPress={() => {
                const t = todayISO();
                setSelectedDate(t);
                setLoading(true);
                load(t);
              }}
              style={styles.resetChip}
            >
              <Text style={styles.resetChipText}>Today</Text>
            </Pressable>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
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
        >
          {error && <Text style={styles.error}>{error}</Text>}

          {isEmployee ? (
            <>
              {/* Employee view: no amounts, no payment info — just
                  operational counts and a quick way to start billing. */}
              <View style={styles.heroCard} testID="dashboard-bills-card">
                <Text style={styles.heroLabel}>Today&apos;s Bills</Text>
                <Text style={styles.heroValue}>{data?.total_bills || 0}</Text>
                <View style={styles.heroRow}>
                  <View style={styles.heroPill}>
                    <Ionicons name="bag-handle-outline" size={14} color={theme.color.brandPrimary} />
                    <Text style={styles.heroPillText}>{data?.items_sold || 0} items sold</Text>
                  </View>
                </View>
              </View>

              <View style={styles.grid}>
                <KpiCard
                  testID="kpi-inventory"
                  icon="cube-outline"
                  label="Stock Qty"
                  value={String(data?.total_inventory_qty || 0)}
                />
                <KpiCard
                  testID="kpi-low-stock"
                  icon="warning-outline"
                  label="Low Stock"
                  value={String(data?.low_stock_count || 0)}
                  warn={(data?.low_stock_count || 0) > 0}
                />
              </View>

              <Pressable
                testID="quick-bill-cta"
                onPress={() => router.push("/(tabs)/billing")}
                style={styles.cta}
              >
                <Ionicons name="add-circle" size={22} color={theme.color.onBrandPrimary} />
                <Text style={styles.ctaText}>New Bill</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.heroCard} testID="dashboard-sales-card">
                <Text style={styles.heroLabel}>
                  {isToday ? "Todays Sales" : "Day's Sales"}
                </Text>
                <Text style={styles.heroValue}>{formatINRPlain(data?.total_sales || 0)}</Text>
                <View style={styles.heroRow}>
                  <View style={styles.heroPill}>
                    <Ionicons name="receipt-outline" size={14} color={theme.color.brandPrimary} />
                    <Text style={styles.heroPillText}>{data?.total_bills || 0} bills</Text>
                  </View>
                  <View style={styles.heroPill}>
                    <Ionicons name="pricetag-outline" size={14} color={theme.color.brandPrimary} />
                    <Text style={styles.heroPillText}>Avg {formatINRPlain(data?.average_bill_value || 0)}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.grid}>
                <KpiCard
                  testID="kpi-cash"
                  icon="cash-outline"
                  label="Cash"
                  value={formatINRPlain(data?.total_cash || 0)}
                />
                <KpiCard
                  testID="kpi-upi"
                  icon="phone-portrait-outline"
                  label="UPI"
                  value={formatINRPlain(data?.total_upi || 0)}
                />
                <KpiCard
                  testID="kpi-items-sold"
                  icon="bag-handle-outline"
                  label="Items Sold"
                  value={String(data?.items_sold || 0)}
                />
                <KpiCard
                  testID="kpi-discount"
                  icon="ribbon-outline"
                  label="Discount"
                  value={formatINRPlain(data?.discount_given || 0)}
                />
                <KpiCard
                  testID="kpi-inventory"
                  icon="cube-outline"
                  label="Stock Qty"
                  value={String(data?.total_inventory_qty || 0)}
                />
                <KpiCard
                  testID="kpi-low-stock"
                  icon="warning-outline"
                  label="Low Stock"
                  value={String(data?.low_stock_count || 0)}
                  warn={(data?.low_stock_count || 0) > 0}
                />
              </View>

              <Pressable
                testID="quick-bill-cta"
                onPress={() => router.push("/(tabs)/billing")}
                style={styles.cta}
              >
                <Ionicons name="add-circle" size={22} color={theme.color.onBrandPrimary} />
                <Text style={styles.ctaText}>New Bill</Text>
              </Pressable>

              {(data?.total_inventory_qty || 0) === 0 && (
                <Pressable testID="seed-button" onPress={onSeed} style={styles.seedBtn}>
                  <Text style={styles.seedText}>Seed Sample Inventory</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      )}

      <SingleDateModal
        visible={datePickerOpen}
        value={selectedDate}
        maxDate={todayISO()}
        onCancel={() => setDatePickerOpen(false)}
        onApply={(iso) => {
          setSelectedDate(iso);
          setDatePickerOpen(false);
          setLoading(true);
          load(iso);
        }}
      />
    </SafeAreaView>
  );
}

/* ------------- Single-date picker modal (owner-only) ------------- */
function SingleDateModal({
  visible,
  value,
  maxDate,
  onCancel,
  onApply,
}: {
  visible: boolean;
  value: string;
  maxDate?: string;
  onCancel: () => void;
  onApply: (iso: string) => void;
}) {
  const [v, setV] = useState(value);
  // Keep local state in sync with parent when reopened for a different value.
  const [lastValue, setLastValue] = useState(value);
  if (visible && lastValue !== value) {
    setLastValue(value);
    setV(value);
  }

  const shift = (delta: number) => setV(shiftISO(v, delta));
  const isoRegex = /^\d{4}-\d{2}-\d{2}$/;
  const invalid = !isoRegex.test(v) || (!!maxDate && v > maxDate);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dateOverlay}>
        <View style={styles.dateBox}>
          <Text style={styles.dateTitle}>Pick a date</Text>
          <Text style={styles.dateHelp}>YYYY-MM-DD · showing dashboard for this date</Text>

          <View style={styles.dateInputRow}>
            <Pressable testID="date-picker-minus" onPress={() => shift(-1)} style={styles.dateStep}>
              <Text style={styles.dateStepText}>-1d</Text>
            </Pressable>
            <TextInput
              testID="date-picker-input"
              value={v}
              onChangeText={setV}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.dateInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable testID="date-picker-plus" onPress={() => shift(1)} style={styles.dateStep}>
              <Text style={styles.dateStepText}>+1d</Text>
            </Pressable>
          </View>

          <View style={styles.dateQuickRow}>
            <Pressable
              testID="date-picker-today"
              onPress={() => setV(todayISO())}
              style={styles.dateQuickBtn}
            >
              <Text style={styles.dateQuickBtnText}>Today</Text>
            </Pressable>
            <Pressable
              testID="date-picker-yesterday"
              onPress={() => setV(shiftISO(todayISO(), -1))}
              style={styles.dateQuickBtn}
            >
              <Text style={styles.dateQuickBtnText}>Yesterday</Text>
            </Pressable>
            <Pressable
              testID="date-picker-7d-ago"
              onPress={() => setV(shiftISO(todayISO(), -7))}
              style={styles.dateQuickBtn}
            >
              <Text style={styles.dateQuickBtnText}>7 days ago</Text>
            </Pressable>
          </View>

          {invalid && (
            <Text style={styles.dateWarn}>
              {!!maxDate && v > maxDate ? "Future dates aren't allowed." : "Use YYYY-MM-DD format."}
            </Text>
          )}

          <View style={styles.dateBtns}>
            <Pressable
              testID="date-picker-cancel"
              onPress={onCancel}
              style={[styles.dateBtn, { backgroundColor: theme.color.surfaceTertiary }]}
            >
              <Text style={styles.dateBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="date-picker-apply"
              disabled={invalid}
              onPress={() => onApply(v)}
              style={[
                styles.dateBtn,
                { backgroundColor: theme.color.brandPrimary, opacity: invalid ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.dateBtnText, { color: theme.color.onBrandPrimary }]}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function KpiCard({
  icon,
  label,
  value,
  warn,
  testID,
}: {
  icon: any;
  label: string;
  value: string;
  warn?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.kpi, warn && { borderColor: theme.color.error, borderWidth: 1 }]}
    >
      <View style={styles.kpiHead}>
        <Ionicons
          name={icon}
          size={16}
          color={warn ? theme.color.error : theme.color.brandPrimary}
        />
        <Text style={styles.kpiLabel}>{label}</Text>
      </View>
      <Text style={[styles.kpiValue, warn && { color: theme.color.error }]}>{value}</Text>
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
  brand: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: 0.8 },
  subtitle: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: theme.color.error, marginBottom: theme.spacing.md },
  heroCard: {
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
  },
  heroLabel: { color: theme.color.onBrandTertiary, fontSize: 13, letterSpacing: 1 },
  heroValue: {
    color: theme.color.brandPrimary,
    fontSize: 38,
    fontWeight: "800",
    marginTop: 6,
    letterSpacing: 0.5,
  },
  heroRow: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    // FIX: was a hardcoded "#1a1408" (near-black), left over from the old
    // dark theme where it sat correctly *underneath* light text on a dark
    // card. Now that heroCard's background is the light `brandTertiary`,
    // this needs to be a subtler tint of the same card color instead of
    // black. Using the app's brandSecondary at low opacity keeps it in
    // the gold/tan family and reads as "a slightly deeper chip on tan,"
    // not a jarring black box.
    backgroundColor: "rgba(170, 135, 67, 0.14)", // brandSecondary (#AA8743) at 14% opacity
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroPillText: { color: theme.color.onBrandTertiary, fontSize: 12, fontWeight: "600" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  kpi: {
    width: "47.5%",
    flexGrow: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  kpiLabel: { color: theme.color.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  kpiValue: { color: theme.color.onSurface, fontSize: 20, fontWeight: "700", marginTop: 8 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 16,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.xl,
  },
  ctaText: { color: theme.color.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  seedBtn: {
    marginTop: theme.spacing.lg,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: "center",
  },
  seedText: { color: theme.color.onSurfaceSecondary, fontSize: 13 },
  // Owner-only date bar (below header)
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  dateArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  datePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: theme.spacing.md,
    height: 34,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
    backgroundColor: theme.color.brandTertiary,
  },
  datePillText: {
    color: theme.color.onBrandTertiary,
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  resetChip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  resetChipText: {
    color: theme.color.onBrandPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
  // Single-date picker modal
  dateOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  dateBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderColor: theme.color.border,
    borderWidth: 1,
    padding: theme.spacing.xl,
  },
  dateTitle: {
    color: theme.color.onSurface,
    fontSize: 18,
    fontWeight: "700",
  },
  dateHelp: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 12,
    marginTop: 4,
    marginBottom: theme.spacing.md,
  },
  dateInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: theme.spacing.md,
  },
  dateInput: {
    flex: 1,
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
  dateStep: {
    height: 46,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dateStepText: { color: theme.color.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  dateQuickRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: theme.spacing.md,
  },
  dateQuickBtn: {
    flex: 1,
    height: 34,
    borderRadius: theme.radius.pill,
    borderColor: theme.color.border,
    borderWidth: 1,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  dateQuickBtnText: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  dateWarn: { color: theme.color.warning, fontSize: 12, marginTop: 2, marginBottom: 6 },
  dateBtns: { flexDirection: "row", gap: 10, marginTop: theme.spacing.sm },
  dateBtn: {
    flex: 1,
    height: 46,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dateBtnText: { color: theme.color.onSurface, fontWeight: "700" },
});
