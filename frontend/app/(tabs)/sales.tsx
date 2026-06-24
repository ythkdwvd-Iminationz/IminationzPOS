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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, Bill } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

const FILTERS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

export default function SalesScreen() {
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("today");
  const [search, setSearch] = useState("");

  const load = useCallback(async (f: string, s: string) => {
    setLoading(true);
    try {
      const res = await api.listBills({ filter: f, search: s || undefined });
      setBills(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(filter, search);
    }, [load, filter, search])
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
        <Text style={styles.title}>Sales History</Text>
        <Text style={styles.subtitle}>{bills.length} bills · {formatINRPlain(totals.sales)}</Text>
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <Pressable
                key={f.id}
                testID={`filter-${f.id}`}
                onPress={() => setFilter(f.id)}
                style={[styles.chip, { borderColor: active ? theme.color.brandPrimary : theme.color.border }]}
              >
                <Text style={{ color: active ? theme.color.brandPrimary : theme.color.onSurfaceSecondary, fontSize: 13, fontWeight: "600" }}>
                  {f.label}
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
          data={bills}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: theme.spacing.sm }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 48 }}>
              <Ionicons name="receipt-outline" size={42} color={theme.color.onSurfaceTertiary} />
              <Text style={{ color: theme.color.onSurfaceTertiary, marginTop: 8 }}>No bills found</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`bill-row-${item.bill_number}`}
              onPress={() => router.push(`/invoice/${item.id}`)}
              style={styles.row}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.billNo}>{item.bill_number}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: item.payment_status === "PAID" ? theme.color.success : theme.color.error },
                    ]}
                  >
                    <Text style={styles.statusText}>{item.payment_status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {item.date} · {item.day} · {item.time}
                </Text>
                <Text style={styles.meta}>
                  Mobile: {item.customer_mobile || "—"} · Cash {formatINRPlain(item.cash_amount)} · UPI {formatINRPlain(item.upi_amount)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.amount}>{formatINRPlain(item.final_amount)}</Text>
                {item.discount > 0 && (
                  <Text style={styles.discount}>-{formatINRPlain(item.discount)} off</Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
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
});
