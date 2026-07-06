import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Share,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, Bill, ExchangeHistoryEntry } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

// The receipt is meant to look like a physical paper receipt — always
// white with black ink — regardless of whether the surrounding app is
// running a light or dark theme. `theme.color.surfaceInverse` is NOT
// the right token for this: it's designed to be "whatever's opposite
// the current app surface," which flips meaning whenever the app theme
// changes (it was near-white under the old dark theme, but is now
// near-black under the new light theme — that's exactly what caused
// the receipt to render with a black background after the theme swap).
// A receipt needs a fixed, theme-independent color instead.
const RECEIPT_PAPER = "#FFFFFF";
const RECEIPT_INK = "#000000";

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeHistoryEntry[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const b = await api.getBill(id);
        setBill(b);
        // Only bother fetching history for bills that were actually
        // exchanged — most bills never touch this table.
        if ((b.exchange_count || 0) > 0) {
          try {
            const hist = await api.getExchangeHistory(id);
            setExchangeHistory(hist);
          } catch {
            // Non-fatal — the invoice still renders fine without history.
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onShare = async () => {
    if (!bill) return;
    const lines = [
      "IMINATIONZ",
      "Jewellery POS",
      "------------------------",
      `Bill: ${bill.bill_number}`,
      `Date: ${bill.date} ${bill.day} ${bill.time}`,
      bill.customer_mobile ? `Mobile: ${bill.customer_mobile}` : null,
      "------------------------",
      ...bill.items.map(
        (i) => `${i.item_name} x${i.qty}  ${formatINRPlain(i.line_total)}`
      ),
      "------------------------",
      `Gross: ${formatINRPlain(bill.gross_amount)}`,
      bill.discount > 0 ? `Discount: -${formatINRPlain(bill.discount)}` : null,
      `Final: ${formatINRPlain(bill.final_amount)}`,
      `Cash: ${formatINRPlain(bill.cash_amount)}`,
      `UPI:  ${formatINRPlain(bill.upi_amount)}`,
      `Status: ${bill.payment_status}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      if (Platform.OS === "web") {
        // Share API may not work on web — copy/print fallback
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(lines);
        }
        if (typeof window !== "undefined" && window.print) {
          window.print();
        }
      } else {
        await Share.share({ message: lines, title: `Invoice ${bill.bill_number}` });
      }
    } catch {
      // ignore
    }
  };

  const onPrint = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.print) {
      window.print();
    } else {
      onShare();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Invoice</Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 32 }} />
      ) : error ? (
        <Text style={[styles.errText]}>{error}</Text>
      ) : bill ? (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
          <View style={styles.receipt} testID="invoice-receipt">
            <Text style={styles.store}>IMINATIONZ</Text>
            <Text style={styles.tag}>Jewellery POS</Text>
            <View style={styles.dash} />
            <Row k="Bill No" v={bill.bill_number} />
            <Row k="Date" v={`${bill.date}`} />
            <Row k="Day" v={bill.day} />
            <Row k="Time" v={bill.time} />
            {bill.customer_name ? <Row k="Name" v={bill.customer_name} /> : null}
            {bill.customer_mobile ? <Row k="Mobile" v={bill.customer_mobile} /> : null}
            <View style={styles.dash} />

            <View style={styles.thead}>
              <Text style={[styles.th, { flex: 2 }]}>Item</Text>
              <Text style={[styles.th, { width: 36, textAlign: "right" }]}>Qty</Text>
              <Text style={[styles.th, { width: 60, textAlign: "right" }]}>Rate</Text>
              <Text style={[styles.th, { width: 70, textAlign: "right" }]}>Total</Text>
            </View>

            {bill.items.map((it, idx) => (
              <View key={idx} style={styles.tr} testID={`invoice-line-${idx}`}>
                <Text style={[styles.td, { flex: 2 }]}>{it.item_name}</Text>
                <Text style={[styles.td, { width: 36, textAlign: "right" }]}>{it.qty}</Text>
                <Text style={[styles.td, { width: 60, textAlign: "right" }]}>
                  {formatINRPlain(it.price)}
                </Text>
                <Text style={[styles.td, { width: 70, textAlign: "right", fontWeight: "700" }]}>
                  {formatINRPlain(it.line_total)}
                </Text>
              </View>
            ))}

            {exchangeHistory.length > 0 && (
              <>
                <View style={styles.dash} />
                <Text style={styles.exchangeHistTitle}>Exchange Record</Text>
                {exchangeHistory.map((ex) => (
                  <View key={ex.id} style={styles.exchangeHistRow} testID={`invoice-exchange-${ex.id}`}>
                    <Text style={styles.exchangeHistDate}>
                      {new Date(ex.exchanged_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      {" · "}
                      {new Date(ex.exchanged_at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    <Text style={styles.exchangeHistLine}>
                      Returned: {ex.old_item_name} (x{ex.old_qty}) — {formatINRPlain(ex.old_line_total)}
                    </Text>
                    <Text style={styles.exchangeHistLine}>
                      Given: {ex.new_item_name} (x{ex.new_qty}) — {formatINRPlain(ex.new_line_total)}
                    </Text>
                    <Text style={styles.exchangeHistDiff}>
                      {ex.price_diff >= 0
                        ? `Customer paid ${formatINRPlain(ex.price_diff)}`
                        : `Refunded ${formatINRPlain(-ex.price_diff)}`}
                    </Text>
                  </View>
                ))}
              </>
            )}

            <View style={styles.dash} />

            <Row k="Gross" v={formatINRPlain(bill.gross_amount)} />
            {bill.discount > 0 && <Row k="Discount 10%" v={`-${formatINRPlain(bill.discount)}`} />}
            <Row k="Final" v={formatINRPlain(bill.final_amount)} bold big />
            <View style={styles.dash} />
            <Row k="Cash" v={formatINRPlain(bill.cash_amount)} />
            <Row k="UPI" v={formatINRPlain(bill.upi_amount)} />

            <View style={[styles.dash, { borderColor: "#000" }]} />
            <View
              testID="invoice-status"
              style={[
                styles.paidStamp,
                { borderColor: bill.payment_status === "PAID" ? "#2E8B57" : "#9B111E" },
              ]}
            >
              <Text
                style={{
                  color: bill.payment_status === "PAID" ? "#2E8B57" : "#9B111E",
                  fontWeight: "800",
                  letterSpacing: 4,
                  fontSize: 22,
                }}
              >
                {bill.payment_status}
              </Text>
            </View>
            <Text style={styles.footer}>Thank you for shopping with us!</Text>
          </View>

          <View style={styles.actions}>
            <Pressable testID="share-button" onPress={onShare} style={[styles.btn, styles.outlineBtn]}>
              <Ionicons name="share-outline" size={18} color={theme.color.onSurface} />
              <Text style={[styles.btnText, { color: theme.color.onSurface }]}>Share / PDF</Text>
            </Pressable>
            <Pressable testID="print-button" onPress={onPrint} style={[styles.btn, styles.primaryBtn]}>
              <Ionicons name="print-outline" size={18} color={theme.color.onBrandPrimary} />
              <Text style={[styles.btnText, { color: theme.color.onBrandPrimary }]}>Print</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ k, v, bold, big }: { k: string; v: string; bold?: boolean; big?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
      <Text style={{ color: "#444", fontSize: big ? 15 : 12, fontWeight: bold ? "700" : "500" }}>{k}</Text>
      <Text style={{ color: RECEIPT_INK, fontSize: big ? 18 : 12, fontWeight: bold ? "800" : "600" }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  errText: { color: theme.color.error, textAlign: "center", marginTop: 24 },
  receipt: {
    // FIX: was `theme.color.surfaceInverse`, which now resolves to a
    // near-black color under the new light theme (it flipped meaning
    // when the app theme changed). A receipt should always be white
    // paper with black ink, independent of the app's theme — using a
    // fixed constant instead of a theme-relative token.
    backgroundColor: RECEIPT_PAPER,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  store: { fontSize: 24, fontWeight: "900", color: RECEIPT_INK, textAlign: "center", letterSpacing: 3 },
  tag: { fontSize: 11, color: "#666", textAlign: "center", marginTop: 2, letterSpacing: 2 },
  dash: { borderTopWidth: 1, borderTopColor: "#bbb", borderStyle: "dashed", marginVertical: 8 },
  exchangeHistTitle: {
    color: "#333",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  exchangeHistRow: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  exchangeHistDate: {
    color: "#888",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 3,
  },
  exchangeHistLine: {
    color: RECEIPT_INK,
    fontSize: 11,
    marginTop: 1,
  },
  exchangeHistDiff: {
    color: "#9B111E",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  thead: { flexDirection: "row", marginTop: 4 },
  th: { color: "#333", fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", paddingVertical: 4 },
  td: { color: RECEIPT_INK, fontSize: 12 },
  paidStamp: {
    alignSelf: "center",
    borderWidth: 3,
    paddingHorizontal: 22,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 12,
    transform: [{ rotate: "-6deg" }],
  },
  footer: { textAlign: "center", color: "#666", fontSize: 11, marginTop: 16, fontStyle: "italic" },
  actions: { flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.xl },
  btn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: theme.radius.md,
  },
  outlineBtn: { borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  primaryBtn: { backgroundColor: theme.color.brandPrimary },
  btnText: { fontWeight: "700", fontSize: 14 },
});
