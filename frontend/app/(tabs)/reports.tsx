import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Linking,
  Platform,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import {
  api,
  DailyReport,
  InventoryReport,
  CategoryRow,
  WhatsAppClosing,
} from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

export default function ReportsScreen() {
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [inv, setInv] = useState<InventoryReport | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsAppClosing | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, i, c, w] = await Promise.all([
        api.dailyReport(),
        api.inventoryReport(),
        api.categoryReport(),
        api.whatsappClosing(),
      ]);
      setDaily(d);
      setInv(i);
      setCategories(c.rows);
      setWhatsapp(w);
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

  const openWhatsApp = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
      else await Linking.openURL(url); // fallback
    } catch {
      // ignore
    }
  };

  const shareSummary = async () => {
    if (!whatsapp) return;
    try {
      if (Platform.OS === "web") {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(whatsapp.message);
        }
      } else {
        await Share.share({ message: whatsapp.message, title: "Daily Closing" });
      }
    } catch {
      // ignore
    }
  };

  const openExport = async (kind: "sales" | "inventory", ext: "xlsx" | "csv") => {
    const url = await api.exportUrl(`/exports/${kind}.${ext}`, kind === "sales" ? { filter: "month" } : {});
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

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
          {/* WhatsApp closing summary */}
          {whatsapp && (
            <View style={styles.waCard} testID="whatsapp-card">
              <View style={styles.waHead}>
                <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                <Text style={styles.waTitle}>Daily Closing — WhatsApp</Text>
              </View>
              <Text style={styles.waPreview}>{whatsapp.message}</Text>
              <View style={styles.waActions}>
                {whatsapp.links.map((l) => (
                  <Pressable
                    key={l.number}
                    testID={`whatsapp-send-${l.number}`}
                    onPress={() => openWhatsApp(l.url)}
                    style={styles.waBtn}
                  >
                    <Ionicons name="logo-whatsapp" size={14} color="#fff" />
                    <Text style={styles.waBtnText}>Send to {l.number}</Text>
                  </Pressable>
                ))}
                <Pressable testID="whatsapp-copy" onPress={shareSummary} style={[styles.waBtn, styles.waBtnGhost]}>
                  <Ionicons name="copy-outline" size={14} color={theme.color.onSurface} />
                  <Text style={[styles.waBtnText, { color: theme.color.onSurface }]}>Copy / Share</Text>
                </Pressable>
              </View>
            </View>
          )}

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

          {/* Category analytics */}
          <Text style={styles.sectionTitle}>Category Performance (all-time)</Text>
          <View style={styles.card} testID="category-card">
            {categories.length === 0 ? (
              <Text style={{ color: theme.color.onSurfaceTertiary, textAlign: "center", paddingVertical: 12 }}>
                No sales yet
              </Text>
            ) : (
              <>
                <View style={styles.catHead}>
                  <Text style={[styles.catCell, { flex: 2 }]}>Category</Text>
                  <Text style={styles.catCell}>Qty</Text>
                  <Text style={styles.catCell}>Revenue</Text>
                  <Text style={styles.catCell}>Profit</Text>
                </View>
                {categories.map((c) => (
                  <View key={c.category} style={styles.catRow} testID={`cat-row-${c.category}`}>
                    <Text style={[styles.catCellTxt, { flex: 2 }]}>{c.category}</Text>
                    <Text style={styles.catCellTxt}>{c.qty_sold}</Text>
                    <Text style={[styles.catCellTxt, { color: theme.color.brandPrimary }]}>
                      {formatINRPlain(c.revenue)}
                    </Text>
                    <Text
                      style={[
                        styles.catCellTxt,
                        { color: c.profit > 0 ? theme.color.success : theme.color.onSurface },
                      ]}
                    >
                      {formatINRPlain(c.profit)}
                      {c.margin_pct > 0 ? ` (${c.margin_pct.toFixed(0)}%)` : ""}
                    </Text>
                  </View>
                ))}
                <Text style={styles.helper}>
                  Profit shown only when Cost Price is set in Inventory.
                </Text>
              </>
            )}
          </View>

          <Text style={styles.sectionTitle}>Inventory Summary</Text>
          <View style={styles.card} testID="inventory-report-card">
            <ReportRow label="Opening Stock" value={String(inv?.summary.total_opening || 0)} />
            <ReportRow label="Current Stock" value={String(inv?.summary.total_current || 0)} highlight />
            <ReportRow label="Sold Stock" value={String(inv?.summary.total_sold || 0)} />
            <ReportRow
              label="Low Stock Items"
              value={String(inv?.summary.low_stock_count || 0)}
              warn={(inv?.summary.low_stock_count || 0) > 0}
            />
          </View>

          {/* Exports */}
          <Text style={styles.sectionTitle}>Export Data</Text>
          <View style={styles.card}>
            <Text style={styles.exportLabel}>Sales (this month)</Text>
            <View style={styles.exportRow}>
              <Pressable testID="export-sales-xlsx" onPress={() => openExport("sales", "xlsx")} style={styles.exBtn}>
                <Ionicons name="document-attach" size={14} color={theme.color.onBrandPrimary} />
                <Text style={styles.exBtnText}>Excel (.xlsx)</Text>
              </Pressable>
              <Pressable testID="export-sales-csv" onPress={() => openExport("sales", "csv")} style={[styles.exBtn, styles.exBtnAlt]}>
                <Ionicons name="document-text" size={14} color={theme.color.onSurface} />
                <Text style={[styles.exBtnText, { color: theme.color.onSurface }]}>CSV</Text>
              </Pressable>
            </View>
            <Text style={[styles.exportLabel, { marginTop: theme.spacing.md }]}>Inventory</Text>
            <View style={styles.exportRow}>
              <Pressable testID="export-inv-xlsx" onPress={() => openExport("inventory", "xlsx")} style={styles.exBtn}>
                <Ionicons name="document-attach" size={14} color={theme.color.onBrandPrimary} />
                <Text style={styles.exBtnText}>Excel (.xlsx)</Text>
              </Pressable>
              <Pressable testID="export-inv-csv" onPress={() => openExport("inventory", "csv")} style={[styles.exBtn, styles.exBtnAlt]}>
                <Ionicons name="document-text" size={14} color={theme.color.onSurface} />
                <Text style={[styles.exBtnText, { color: theme.color.onSurface }]}>CSV</Text>
              </Pressable>
            </View>
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
  catHead: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  catCell: {
    flex: 1,
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "700",
    textAlign: "right",
  },
  catRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  catCellTxt: {
    flex: 1,
    color: theme.color.onSurface,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  helper: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 8,
  },
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
  waCard: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: "#25D366",
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  waHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  waTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  waPreview: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    marginTop: 8,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    backgroundColor: theme.color.surfaceTertiary,
    padding: 10,
    borderRadius: theme.radius.sm,
  },
  waActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  waBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#25D366",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
  },
  waBtnGhost: { backgroundColor: theme.color.surfaceTertiary },
  waBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  exportLabel: { color: theme.color.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  exportRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  exBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
  exBtnAlt: { backgroundColor: theme.color.surfaceTertiary },
  exBtnText: { color: theme.color.onBrandPrimary, fontSize: 13, fontWeight: "700" },
});
