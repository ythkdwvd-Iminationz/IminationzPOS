import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, clearToken, DashboardData } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

export default function DashboardScreen() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.dashboard();
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
  }, [router]);

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
        <View>
          <Text style={styles.brand}>{data?.store_name || "Iminationz"}</Text>
          <Text style={styles.subtitle}>Todays overview · {data?.date || ""}</Text>
        </View>
        <Pressable testID="logout-button" onPress={onLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={theme.color.onSurface} />
        </Pressable>
      </View>

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

          <View style={styles.heroCard} testID="dashboard-sales-card">
            <Text style={styles.heroLabel}>Todays Sales</Text>
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
        </ScrollView>
      )}
    </SafeAreaView>
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
    backgroundColor: "#1a1408",
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
});
