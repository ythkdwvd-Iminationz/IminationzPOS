import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, InventoryItem } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

interface CartLine {
  inv: InventoryItem;
  qty: number;
}

export default function BillingScreen() {
  const router = useRouter();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerMobile, setCustomerMobile] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listInventory();
      setInventory(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const { gross, discount, finalAmount, paid, payable, isValid, status } = useMemo(() => {
    const gross = cart.reduce((s, l) => s + l.inv.price * l.qty, 0);
    const discount = gross > 699 ? Math.round(gross * 0.1 * 100) / 100 : 0;
    const finalAmount = Math.round((gross - discount) * 100) / 100;
    const c = parseFloat(cashAmount || "0") || 0;
    const u = parseFloat(upiAmount || "0") || 0;
    const paid = Math.round((c + u) * 100) / 100;
    const payable = Math.round((finalAmount - paid) * 100) / 100;
    const isValid = cart.length > 0 && Math.abs(paid - finalAmount) < 0.01;
    return {
      gross,
      discount,
      finalAmount,
      paid,
      payable,
      isValid,
      status: isValid ? "PAID" : "DRAFT",
    };
  }, [cart, cashAmount, upiAmount]);

  const updateQty = (invId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((l) => {
          if (l.inv.id !== invId) return l;
          const newQty = l.qty + delta;
          if (newQty <= 0) return null;
          if (newQty > l.inv.current_qty) {
            setError(`Only ${l.inv.current_qty} in stock for ${l.inv.item_name}`);
            return l;
          }
          return { ...l, qty: newQty };
        })
        .filter(Boolean) as CartLine[];
    });
  };

  const setQty = (invId: string, val: string) => {
    const n = parseInt(val || "0", 10);
    setCart((prev) =>
      prev.map((l) => {
        if (l.inv.id !== invId) return l;
        if (n > l.inv.current_qty) {
          setError(`Only ${l.inv.current_qty} in stock for ${l.inv.item_name}`);
          return { ...l, qty: l.inv.current_qty };
        }
        return { ...l, qty: Math.max(1, n) };
      })
    );
  };

  const removeLine = (invId: string) => {
    setCart((prev) => prev.filter((l) => l.inv.id !== invId));
  };

  const addItemToCart = (inv: InventoryItem) => {
    setError(null);
    if (inv.current_qty <= 0) {
      setError(`${inv.item_name} is out of stock`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.inv.id === inv.id);
      if (existing) {
        if (existing.qty + 1 > inv.current_qty) {
          setError(`Only ${inv.current_qty} in stock for ${inv.item_name}`);
          return prev;
        }
        return prev.map((l) => (l.inv.id === inv.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { inv, qty: 1 }];
    });
    setPickerOpen(false);
    setPickerSearch("");
  };

  const reset = () => {
    setCart([]);
    setCustomerMobile("");
    setCashAmount("");
    setUpiAmount("");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!isValid) {
      setError("Cash + UPI must equal final amount");
      return;
    }
    setSubmitting(true);
    try {
      const bill = await api.createBill({
        customer_mobile: customerMobile.trim() || null,
        cash_amount: parseFloat(cashAmount || "0") || 0,
        upi_amount: parseFloat(upiAmount || "0") || 0,
        items: cart.map((l) => ({
          inv_id: l.inv.id,
          item_id: l.inv.item_id,
          item_name: l.inv.item_name,
          price: l.inv.price,
          qty: l.qty,
          line_total: l.inv.price * l.qty,
        })),
      });
      reset();
      router.push(`/invoice/${bill.id}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredInventory = inventory.filter(
    (i) =>
      i.current_qty > 0 &&
      (pickerSearch.trim() === "" ||
        i.item_name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        i.category.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        i.item_id.toLowerCase().includes(pickerSearch.toLowerCase()))
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>New Bill</Text>
          <Pressable testID="reset-bill" onPress={reset} style={styles.resetBtn}>
            <Ionicons name="refresh" size={18} color={theme.color.onSurface} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Customer Mobile (optional)</Text>
          <TextInput
            testID="customer-mobile-input"
            value={customerMobile}
            onChangeText={setCustomerMobile}
            keyboardType="phone-pad"
            placeholder="10-digit mobile"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
            maxLength={15}
          />

          <Pressable
            testID="add-item-button"
            onPress={() => setPickerOpen(true)}
            style={styles.addItemBtn}
          >
            <Ionicons name="add" size={22} color={theme.color.onBrandPrimary} />
            <Text style={styles.addItemText}>Add Item</Text>
          </Pressable>

          {loading && <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 12 }} />}

          {cart.length === 0 && !loading && (
            <View style={styles.empty} testID="empty-cart">
              <Ionicons name="cart-outline" size={36} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No items yet. Tap Add Item.</Text>
            </View>
          )}

          {cart.map((l) => (
            <View key={l.inv.id} style={styles.line} testID={`cart-line-${l.inv.item_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName}>{l.inv.item_name}</Text>
                <Text style={styles.lineSub}>
                  {formatINRPlain(l.inv.price)} · stock {l.inv.current_qty}
                </Text>
              </View>
              <View style={styles.qtyBox}>
                <Pressable
                  testID={`qty-dec-${l.inv.item_id}`}
                  onPress={() => updateQty(l.inv.id, -1)}
                  style={styles.qtyBtn}
                >
                  <Ionicons name="remove" size={16} color={theme.color.onSurface} />
                </Pressable>
                <TextInput
                  testID={`qty-input-${l.inv.item_id}`}
                  value={String(l.qty)}
                  onChangeText={(v) => setQty(l.inv.id, v)}
                  keyboardType="number-pad"
                  style={styles.qtyInput}
                />
                <Pressable
                  testID={`qty-inc-${l.inv.item_id}`}
                  onPress={() => updateQty(l.inv.id, 1)}
                  style={styles.qtyBtn}
                >
                  <Ionicons name="add" size={16} color={theme.color.onSurface} />
                </Pressable>
              </View>
              <Text style={styles.lineTotal}>{formatINRPlain(l.inv.price * l.qty)}</Text>
              <Pressable
                testID={`remove-${l.inv.item_id}`}
                onPress={() => removeLine(l.inv.id)}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={20} color={theme.color.error} />
              </Pressable>
            </View>
          ))}

          {error && (
            <Text testID="bill-error" style={styles.error}>
              {error}
            </Text>
          )}

          <View style={{ height: 280 }} />
        </ScrollView>

        {/* Sticky payment panel */}
        <View style={styles.paymentPanel}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gross</Text>
            <Text style={styles.summaryValue}>{formatINRPlain(gross)}</Text>
          </View>
          {discount > 0 && (
            <View style={styles.summaryRow}>
              <View style={styles.discountTag}>
                <Text style={styles.discountTagText}>10% OFF</Text>
              </View>
              <Text style={[styles.summaryValue, { color: theme.color.warning }]}>
                -{formatINRPlain(discount)}
              </Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelBig}>Final</Text>
            <Text style={styles.summaryValueBig} testID="final-amount">
              {formatINRPlain(finalAmount)}
            </Text>
          </View>

          <View style={styles.payRow}>
            <View style={styles.payField}>
              <Text style={styles.label}>Cash</Text>
              <TextInput
                testID="cash-input"
                value={cashAmount}
                onChangeText={setCashAmount}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={styles.input}
              />
            </View>
            <View style={styles.payField}>
              <Text style={styles.label}>UPI (negative for change)</Text>
              <TextInput
                testID="upi-input"
                value={upiAmount}
                onChangeText={setUpiAmount}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Paid (Cash + UPI)</Text>
            <Text style={styles.summaryValue}>{formatINRPlain(paid)}</Text>
          </View>
          {Math.abs(payable) > 0.01 && (
            <Text
              testID="payable-diff"
              style={[styles.diff, { color: payable > 0 ? theme.color.error : theme.color.warning }]}
            >
              {payable > 0
                ? `Short by ${formatINRPlain(payable)}`
                : `Over by ${formatINRPlain(-payable)}`}
            </Text>
          )}

          <View style={styles.statusRow}>
            <View
              testID="status-badge"
              style={[
                styles.statusBadge,
                { backgroundColor: status === "PAID" ? theme.color.success : theme.color.error },
              ]}
            >
              <Ionicons
                name={status === "PAID" ? "checkmark-circle" : "close-circle"}
                size={14}
                color="#fff"
              />
              <Text style={styles.statusText}>{status}</Text>
            </View>
            <Pressable
              testID="complete-bill-button"
              onPress={submit}
              disabled={!isValid || submitting}
              style={[
                styles.completeBtn,
                (!isValid || submitting) && { opacity: 0.5 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={theme.color.onBrandPrimary} />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={20} color={theme.color.onBrandPrimary} />
                  <Text style={styles.completeText}>Complete Bill</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>

        {/* Item picker modal */}
        <Modal
          visible={pickerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Item</Text>
                <Pressable testID="close-picker" onPress={() => setPickerOpen(false)}>
                  <Ionicons name="close" size={24} color={theme.color.onSurface} />
                </Pressable>
              </View>
              <TextInput
                testID="picker-search"
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Search by name, category, ID"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={[styles.input, { margin: theme.spacing.lg }]}
              />
              <FlatList
                data={filteredInventory}
                keyExtractor={(it) => it.id}
                renderItem={({ item }) => (
                  <Pressable
                    testID={`pick-${item.item_id}`}
                    onPress={() => addItemToCart(item)}
                    style={styles.pickRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName}>{item.item_name}</Text>
                      <Text style={styles.pickSub}>
                        {item.category} · {formatINRPlain(item.price)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.stockChip,
                        item.current_qty <= 5 && { backgroundColor: theme.color.error },
                      ]}
                    >
                      <Text style={styles.stockChipText}>Qty {item.current_qty}</Text>
                    </View>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={styles.pickEmpty}>No items found</Text>
                }
              />
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  resetBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: theme.spacing.lg, paddingBottom: 0 },
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
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.lg,
  },
  addItemText: { color: theme.color.onBrandPrimary, fontWeight: "700", fontSize: 15 },
  empty: { alignItems: "center", paddingVertical: theme.spacing.xxl, gap: 8 },
  emptyText: { color: theme.color.onSurfaceTertiary },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  lineName: { color: theme.color.onSurface, fontWeight: "600", fontSize: 14 },
  lineSub: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: theme.radius.sm,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyInput: {
    width: 36,
    color: theme.color.onSurface,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "700",
  },
  lineTotal: {
    color: theme.color.brandPrimary,
    fontWeight: "700",
    fontSize: 14,
    minWidth: 64,
    textAlign: "right",
  },
  error: { color: theme.color.error, marginTop: theme.spacing.md, fontSize: 13 },
  paymentPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.color.surfaceSecondary,
    borderTopColor: theme.color.brandPrimary,
    borderTopWidth: 1,
    padding: theme.spacing.lg,
    gap: 6,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { color: theme.color.onSurfaceTertiary, fontSize: 13 },
  summaryValue: { color: theme.color.onSurface, fontSize: 14, fontWeight: "600" },
  summaryLabelBig: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
  summaryValueBig: { color: theme.color.brandPrimary, fontSize: 22, fontWeight: "800" },
  discountTag: {
    backgroundColor: theme.color.brandTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  discountTagText: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: "700" },
  payRow: { flexDirection: "row", gap: theme.spacing.md, marginTop: 8 },
  payField: { flex: 1 },
  diff: { fontSize: 12, marginTop: 4 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  statusText: { color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  completeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
  },
  completeText: { color: theme.color.onBrandPrimary, fontWeight: "800", fontSize: 16 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: theme.color.surface,
    height: "80%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopColor: theme.color.brandPrimary,
    borderTopWidth: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  modalTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.lg,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  pickName: { color: theme.color.onSurface, fontWeight: "600", fontSize: 15 },
  pickSub: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  stockChip: {
    backgroundColor: theme.color.surfaceTertiary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  stockChipText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  pickEmpty: {
    color: theme.color.onSurfaceTertiary,
    textAlign: "center",
    marginTop: theme.spacing.xl,
  },
});
