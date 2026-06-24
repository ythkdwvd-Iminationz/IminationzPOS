import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, DailyReport, InventoryReport } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

export default function ReportsScreen() {
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [inv, setInv] = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, i] = await Promise.all([api.dailyReport(), api.inventoryReport()]);
      setDaily(d);
      setInv(i);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Reports</Text>
        <Pressable testID="reload-reports" onPress={load} style={styles.reloadBtn}>
          <Ionicons name="refresh" size={18} color={theme.color.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionTitle}>Daily Sales · {daily?.date}</Text>
          <View style={styles.card} testID="daily-report-card">
            <ReportRow label="Total Bills" value={String(daily?.total_bills || 0)} />
            <ReportRow label="Total Sales" value={formatINRPlain(daily?.total_sales || 0)} highlight />
            <ReportRow label="Cash" value={formatINRPlain(daily?.total_cash || 0)} />
            <ReportRow label="UPI" value={formatINRPlain(daily?.total_upi || 0)} />
            <ReportRow label="Discount Given" value={formatINRPlain(daily?.discount_given || 0)} />
            <ReportRow label="Items Sold" value={String(daily?.items_sold || 0)} />
            <ReportRow label="Avg Bill Value" value={formatINRPlain(daily?.average_bill_value || 0)} />
          </View>

          <Text style={styles.sectionTitle}>Inventory Summary</Text>
          <View style={styles.card} testID="inventory-report-card">
            <ReportRow label="Opening Stock" value={String(inv?.summary.total_opening || 0)} />
            <ReportRow label="Current Stock" value={String(inv?.summary.total_current || 0)} highlight />
            <ReportRow label="Sold Stock" value={String(inv?.summary.total_sold || 0)} />
            <ReportRow label="Low Stock Items" value={String(inv?.summary.low_stock_count || 0)} warn={(inv?.summary.low_stock_count || 0) > 0} />
          </View>

          {inv && inv.low_stock.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Low Stock Items</Text>
              <View style={styles.card}>
                {inv.low_stock.map((it) => (
                  <View key={it.id} style={styles.lowRow} testID={`low-${it.item_id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lowName}>{it.item_name}</Text>
                      <Text style={styles.lowSub}>
                        {it.category} · {formatINRPlain(it.price)}
                      </Text>
                    </View>
                    <View style={styles.lowBadge}>
                      <Text style={styles.lowBadgeText}>Qty {it.current_qty}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ReportRow({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <View style={styles.reportRow}>
      <Text style={styles.reportLabel}>{label}</Text>
      <Text
        style={[
          styles.reportValue,
          highlight && { color: theme.color.brandPrimary, fontSize: 18 },
          warn && { color: theme.color.error },
        ]}
      >
        {value}
      </Text>
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
  reloadBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl },
  sectionTitle: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  card: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  reportRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  reportLabel: { color: theme.color.onSurfaceTertiary, fontSize: 13 },
  reportValue: { color: theme.color.onSurface, fontWeight: "700", fontSize: 14 },
  lowRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  lowName: { color: theme.color.onSurface, fontWeight: "600", fontSize: 14 },
  lowSub: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  lowBadge: { backgroundColor: theme.color.error, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  lowBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
