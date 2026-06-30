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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, InventoryItem, CustomerInfo } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

// Display-only rounding: 120.5+ -> 121, 120.4 and below -> 120 (standard Math.round)
const fmt = (n: number) => formatINRPlain(Math.round(n));

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
  const [customerName, setCustomerName] = useState("");
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer details modal state
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [tempCustomerMobile, setTempCustomerMobile] = useState("");
  const [tempCustomerName, setTempCustomerName] = useState("");
  const [tempCustomerInfo, setTempCustomerInfo] = useState<CustomerInfo | null>(null);

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
    // Round to whole rupees here so this matches exactly what's displayed (fmt() also rounds).
    // Without this, the displayed "Final" could show e.g. ₹121 while the real value used for
    // validation is 120.5x, making Cash+UPI never exactly match and Complete Bill stay disabled.
    const finalAmount = Math.round(gross - discount);
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

  const onCashChange = (val: string) => {
    setCashAmount(val);
    const cashNum = parseFloat(val || "0") || 0;
    const remainder = Math.round((finalAmount - cashNum) * 100) / 100;
    setUpiAmount(remainder === 0 ? "0" : String(remainder));
  };

  const onUpiChange = (val: string) => {
    setUpiAmount(val);
    const upiNum = parseFloat(val || "0") || 0;
    const remainder = Math.round((finalAmount - upiNum) * 100) / 100;
    setCashAmount(remainder === 0 ? "0" : String(remainder));
  };

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

  const cartQtyFor = (invId: string) => cart.find((l) => l.inv.id === invId)?.qty ?? 0;

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
  };

  const decrementFromPicker = (inv: InventoryItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.inv.id === inv.id);
      if (!existing) return prev;
      if (existing.qty - 1 <= 0) {
        return prev.filter((l) => l.inv.id !== inv.id);
      }
      return prev.map((l) => (l.inv.id === inv.id ? { ...l, qty: l.qty - 1 } : l));
    });
  };

  const closePicker = () => {
    setPickerOpen(false);
    setPickerSearch("");
    setSelectedCategory(null);
  };

  const reset = () => {
    setCart([]);
    setCustomerMobile("");
    setCustomerName("");
    setCustomerInfo(null);
    setCashAmount("");
    setUpiAmount("");
    setError(null);
    setTempCustomerMobile("");
    setTempCustomerName("");
    setTempCustomerInfo(null);
  };

  const onMobileBlur = async (mobile: string) => {
    const cleanMobile = mobile.trim();
    if (!cleanMobile || cleanMobile.length < 6) {
      setTempCustomerInfo(null);
      return;
    }
    try {
      const info = await api.lookupCustomer(cleanMobile);
      setTempCustomerInfo(info);
      if (info.is_returning && info.last_name && !tempCustomerName.trim()) {
        setTempCustomerName(info.last_name);
      }
    } catch {
      setTempCustomerInfo(null);
    }
  };

  const openCompleteModal = () => {
    if (!isValid) {
      setError("Cash + UPI must equal final amount");
      return;
    }
    // Reset modal state
    setTempCustomerMobile("");
    setTempCustomerName("");
    setTempCustomerInfo(null);
    setCustomerModalOpen(true);
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const bill = await api.createBill({
        customer_mobile: tempCustomerMobile.trim() || null,
        customer_name: tempCustomerName.trim() || null,
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
      setCustomerModalOpen(false);
      router.push(`/invoice/${bill.id}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Distinct categories from in-stock inventory, alphabetically sorted
  const categories = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((i) => {
      if (i.current_qty > 0) set.add(i.category);
    });
    return Array.from(set).sort();
  }, [inventory]);

  // Auto-select first category whenever picker opens (if none chosen yet)
  const openPicker = () => {
    setPickerOpen(true);
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0]);
    }
  };

  const filteredInventory = inventory.filter((i) => {
    if (i.current_qty <= 0) return false;
    const matchesSearch =
      pickerSearch.trim() === "" ||
      i.item_name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
      i.category.toLowerCase().includes(pickerSearch.toLowerCase()) ||
      i.item_id.toLowerCase().includes(pickerSearch.toLowerCase());
    if (!matchesSearch) return false;
    // When searching, ignore category filter so results span all categories
    if (pickerSearch.trim() !== "") return true;
    return selectedCategory ? i.category === selectedCategory : true;
  });

  const totalPickerItems = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>New Bill</Text>
          <Pressable testID="reset-bill" onPress={reset} style={styles.resetBtn}>
            <Ionicons name="refresh" size={18} color={theme.color.onSurface} />
          </Pressable>
        </View>

        {/* Main content area */}
        <View style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Top section - Add Item Button only (minimal space) */}
          <View style={styles.topSection}>
            <Pressable
              testID="add-item-button"
              onPress={openPicker}
              style={styles.addItemBtn}
            >
              <Ionicons name="add" size={22} color={theme.color.onBrandPrimary} />
              <Text style={styles.addItemText}>Add Item</Text>
            </Pressable>
          </View>

          {/* Middle section - Scrollable items list */}
          <View style={{ flex: 1, minHeight: 0 }}>
            {loading ? (
              <View style={styles.centerContent}>
                <ActivityIndicator color={theme.color.brandPrimary} />
              </View>
            ) : cart.length === 0 ? (
              <View style={styles.centerContent}>
                <Ionicons name="cart-outline" size={36} color={theme.color.onSurfaceTertiary} />
                <Text style={styles.emptyText}>No items yet. Tap Add Item.</Text>
              </View>
            ) : (
              <FlatList
                data={cart}
                keyExtractor={(l) => l.inv.id}
                contentContainerStyle={styles.itemsListContent}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: l }) => (
                  <View key={l.inv.id} style={styles.line} testID={`cart-line-${l.inv.item_id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineName}>{l.inv.item_name}</Text>
                      <Text style={styles.lineSub}>
                        {fmt(l.inv.price)} · stock {l.inv.current_qty}
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
                    <Text style={styles.lineTotal}>{fmt(l.inv.price * l.qty)}</Text>
                    <Pressable
                      testID={`remove-${l.inv.item_id}`}
                      onPress={() => removeLine(l.inv.id)}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={20} color={theme.color.error} />
                    </Pressable>
                  </View>
                )}
              />
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Text testID="bill-error" style={styles.error}>
                  {error}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Bottom section - Fixed payment panel */}
        <View style={styles.paymentPanel}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gross</Text>
            <Text style={styles.summaryValue}>{fmt(gross)}</Text>
          </View>
          {discount > 0 && (
            <View style={styles.summaryRow}>
              <View style={styles.discountTag}>
                <Text style={styles.discountTagText}>10% OFF</Text>
              </View>
              <Text style={[styles.summaryValue, { color: theme.color.warning }]}>
                -{fmt(discount)}
              </Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelBig}>Final</Text>
            <Text style={styles.summaryValueBig} testID="final-amount">
              {fmt(finalAmount)}
            </Text>
          </View>

          <View style={styles.payRow}>
            <View style={styles.payField}>
              <Text style={styles.label}>Cash</Text>
              <TextInput
                testID="cash-input"
                value={cashAmount}
                onChangeText={onCashChange}
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
                onChangeText={onUpiChange}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Paid (Cash + UPI)</Text>
            <Text style={styles.summaryValue}>{fmt(paid)}</Text>
          </View>
          {Math.abs(payable) > 0.01 && (
            <Text
              testID="payable-diff"
              style={[styles.diff, { color: payable > 0 ? theme.color.error : theme.color.warning }]}
            >
              {payable > 0
                ? `Short by ${fmt(payable)}`
                : `Over by ${fmt(-payable)}`}
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
              onPress={openCompleteModal}
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

        {/* Item picker modal - category list (left) + item grid (right) */}
        <Modal
          visible={pickerOpen}
          animationType="slide"
          transparent
          onRequestClose={closePicker}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Items</Text>
                <View style={styles.modalHeaderRight}>
                  {totalPickerItems > 0 && (
                    <View style={styles.cartCountChip}>
                      <Ionicons name="cart" size={13} color={theme.color.onBrandPrimary} />
                      <Text style={styles.cartCountChipText}>{totalPickerItems}</Text>
                    </View>
                  )}
                  <Pressable testID="close-picker" onPress={closePicker} hitSlop={8}>
                    <Ionicons name="close" size={24} color={theme.color.onSurface} />
                  </Pressable>
                </View>
              </View>

              <TextInput
                testID="picker-search"
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Search by name, category, ID"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={[styles.input, { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg }]}
              />

              {/* Split body: category rail on left, item grid on right */}
              <View style={styles.pickerBody}>
                {pickerSearch.trim() === "" && (
                  <View style={styles.categoryRail}>
                    <FlatList
                      testID="category-rail"
                      data={categories}
                      keyExtractor={(c) => c}
                      contentContainerStyle={{ paddingVertical: theme.spacing.sm }}
                      renderItem={({ item: cat }) => {
                        const active = cat === selectedCategory;
                        return (
                          <Pressable
                            testID={`category-${cat}`}
                            onPress={() => setSelectedCategory(cat)}
                            style={[styles.categoryItem, active && styles.categoryItemActive]}
                          >
                            <Text
                              style={[styles.categoryItemText, active && styles.categoryItemTextActive]}
                              numberOfLines={2}
                            >
                              {cat}
                            </Text>
                          </Pressable>
                        );
                      }}
                    />
                  </View>
                )}

                <FlatList
                  testID="item-grid"
                  data={filteredInventory}
                  keyExtractor={(it) => it.id}
                  numColumns={2}
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.itemGridContent}
                  columnWrapperStyle={{ gap: theme.spacing.sm, justifyContent: "space-between" }}
                  renderItem={({ item }) => {
                    const qtyInCart = cartQtyFor(item.id);
                    return (
                      <View style={styles.itemCard} testID={`item-card-${item.item_id}`}>
                        <Text style={styles.itemCardName} numberOfLines={2}>
                          {item.item_name}
                        </Text>
                        <Text style={styles.itemCardSub}>
                          {fmt(item.price)}
                        </Text>
                        <View
                          style={[
                            styles.itemCardStock,
                            item.current_qty <= 5 && { backgroundColor: theme.color.error },
                          ]}
                        >
                          <Text style={styles.itemCardStockText}>Qty {item.current_qty}</Text>
                        </View>

                        {qtyInCart === 0 ? (
                          <Pressable
                            testID={`pick-${item.item_id}`}
                            onPress={() => addItemToCart(item)}
                            style={styles.itemCardAddBtn}
                          >
                            <Ionicons name="add" size={18} color={theme.color.onBrandPrimary} />
                          </Pressable>
                        ) : (
                          <View style={styles.itemCardQtyBox}>
                            <Pressable
                              testID={`pick-dec-${item.item_id}`}
                              onPress={() => decrementFromPicker(item)}
                              style={styles.itemCardQtyBtn}
                            >
                              <Ionicons name="remove" size={16} color={theme.color.onSurface} />
                            </Pressable>
                            <Text style={styles.itemCardQtyText}>{qtyInCart}</Text>
                            <Pressable
                              testID={`pick-inc-${item.item_id}`}
                              onPress={() => addItemToCart(item)}
                              style={styles.itemCardQtyBtn}
                            >
                              <Ionicons name="add" size={16} color={theme.color.onSurface} />
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={styles.pickEmpty}>No items found</Text>
                  }
                />
              </View>

              <Pressable
                testID="picker-done"
                onPress={closePicker}
                style={styles.pickerDoneBtn}
              >
                <Text style={styles.pickerDoneText}>
                  {totalPickerItems > 0 ? `Done (${totalPickerItems} item${totalPickerItems > 1 ? "s" : ""})` : "Done"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Customer details modal - shown when Complete Bill is clicked */}
        <Modal
          visible={customerModalOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setCustomerModalOpen(false)}
        >
          <View style={styles.customerModalBackdrop}>
            <View style={styles.customerModalContent}>
              <View style={styles.customerModalHeader}>
                <Text style={styles.customerModalTitle}>Customer Details</Text>
                <Pressable 
                  testID="close-customer-modal"
                  onPress={() => setCustomerModalOpen(false)}
                  disabled={submitting}
                >
                  <Ionicons name="close" size={24} color={theme.color.onSurface} />
                </Pressable>
              </View>

              <View style={styles.customerModalBody}>
                <Text style={styles.label}>Mobile Number (optional)</Text>
                <TextInput
                  testID="customer-mobile-modal-input"
                  value={tempCustomerMobile}
                  onChangeText={setTempCustomerMobile}
                  onBlur={() => onMobileBlur(tempCustomerMobile)}
                  keyboardType="phone-pad"
                  placeholder="10-digit mobile"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={styles.input}
                  maxLength={15}
                  editable={!submitting}
                />

                {tempCustomerInfo?.is_returning && (
                  <View testID="returning-customer-badge" style={styles.returningBadge}>
                    <Ionicons name="star" size={14} color={theme.color.brandPrimary} />
                    <Text style={styles.returningText}>
                      Returning · {tempCustomerInfo.visits} visits · {fmt(tempCustomerInfo.total_spent)} lifetime
                    </Text>
                  </View>
                )}

                <Text style={[styles.label, { marginTop: theme.spacing.lg }]}>Customer Name (optional)</Text>
                <TextInput
                  testID="customer-name-modal-input"
                  value={tempCustomerName}
                  onChangeText={setTempCustomerName}
                  placeholder="e.g. Riya Sharma"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={styles.input}
                  editable={!submitting}
                />

                <View style={styles.billSummaryContainer}>
                  <Text style={styles.billSummaryLabel}>Bill Summary</Text>
                  <View style={styles.billSummaryRow}>
                    <Text style={styles.billSummaryText}>Items:</Text>
                    <Text style={styles.billSummaryText}>{cart.length}</Text>
                  </View>
                  <View style={styles.billSummaryRow}>
                    <Text style={styles.billSummaryText}>Total:</Text>
                    <Text style={styles.billSummaryValueBig}>{fmt(finalAmount)}</Text>
                  </View>
                  <View style={styles.billSummaryRow}>
                    <Text style={styles.billSummaryText}>Payment:</Text>
                    <Text style={styles.billSummaryValueBig}>{fmt(paid)}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.customerModalActions}>
                <Pressable
                  style={[styles.cancelBtn, submitting && { opacity: 0.5 }]}
                  onPress={() => setCustomerModalOpen(false)}
                  disabled={submitting}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.submitBtn, (!isValid || submitting) && { opacity: 0.5 }]}
                  onPress={submit}
                  disabled={!isValid || submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color={theme.color.onBrandPrimary} />
                      <Text style={styles.submitBtnText}>Confirm & Complete</Text>
                    </>
                  )}
                </Pressable>
              </View>
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
  topSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
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
  },
  addItemText: { color: theme.color.onBrandPrimary, fontWeight: "700", fontSize: 15 },
  centerContent: { 
    flex: 1, 
    alignItems: "center", 
    justifyContent: "center", 
    gap: 8 
  },
  emptyText: { color: theme.color.onSurfaceTertiary },
  itemsListContent: { 
    paddingHorizontal: theme.spacing.lg, 
    paddingVertical: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
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
  errorContainer: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  error: { color: theme.color.error, fontSize: 13 },
  paymentPanel: {
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
  returningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.sm,
    alignSelf: "flex-start",
  },
  returningText: { color: theme.color.brandPrimary, fontSize: 12, fontWeight: "700" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: theme.color.surface,
    height: "90%",
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
  modalHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  modalTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  cartCountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.color.brandPrimary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
  },
  cartCountChipText: { color: theme.color.onBrandPrimary, fontSize: 12, fontWeight: "700" },

  pickerBody: {
    flex: 1,
    flexDirection: "row",
    marginTop: theme.spacing.md,
  },
  categoryRail: {
    minWidth: 64,
    maxWidth: 110,
    borderRightColor: theme.color.divider,
    borderRightWidth: 1,
  },
  categoryItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  categoryItemActive: {
    borderLeftColor: theme.color.brandPrimary,
    backgroundColor: theme.color.surfaceSecondary,
  },
  categoryItemText: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "600",
  },
  categoryItemTextActive: {
    color: theme.color.brandPrimary,
    fontWeight: "800",
  },

  itemGridContent: {
    flexGrow: 1,
    padding: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
  },
  itemCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    paddingBottom: 44,
    marginBottom: theme.spacing.sm,
    minHeight: 120,
  },
  itemCardName: {
    color: theme.color.onSurface,
    fontWeight: "600",
    fontSize: 13,
    marginBottom: 4,
  },
  itemCardSub: {
    color: theme.color.brandPrimary,
    fontWeight: "700",
    fontSize: 13,
  },
  itemCardStock: {
    alignSelf: "flex-start",
    backgroundColor: theme.color.surfaceTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    marginTop: 6,
  },
  itemCardStockText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  itemCardAddBtn: {
    position: "absolute",
    bottom: theme.spacing.sm,
    right: theme.spacing.sm,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCardQtyBox: {
    position: "absolute",
    bottom: theme.spacing.sm,
    right: theme.spacing.sm,
    left: theme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.color.surfaceTertiary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 4,
  },
  itemCardQtyBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCardQtyText: {
    color: theme.color.onSurface,
    fontWeight: "700",
    fontSize: 13,
  },

  pickerDoneBtn: {
    margin: theme.spacing.lg,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  pickerDoneText: {
    color: theme.color.onBrandPrimary,
    fontWeight: "800",
    fontSize: 15,
  },

  pickEmpty: {
    color: theme.color.onSurfaceTertiary,
    textAlign: "center",
    marginTop: theme.spacing.xl,
  },

  // Customer details modal styles
  customerModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  customerModalContent: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopColor: theme.color.brandPrimary,
    borderTopWidth: 2,
    maxHeight: "85%",
  },
  customerModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  customerModalTitle: {
    color: theme.color.onSurface,
    fontSize: 20,
    fontWeight: "700",
  },
  customerModalBody: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  billSummaryContainer: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.lg,
  },
  billSummaryLabel: {
    color: theme.color.onSurface,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: theme.spacing.md,
  },
  billSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  billSummaryText: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
  },
  billSummaryValueBig: {
    color: theme.color.brandPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  customerModalActions: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 15,
    fontWeight: "700",
  },
  submitBtn: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submitBtnText: {
    color: theme.color.onBrandPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
});
