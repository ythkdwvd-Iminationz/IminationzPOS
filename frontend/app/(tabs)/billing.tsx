import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { api, InventoryItem, CustomerInfo, logout, settingsApi, BillingConfig, DiscountType } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";
import { useDraftBilling } from "@/src/draft/useDraftBilling";
import { DraftCartLine } from "@/src/draft/draftBillingStorage";
import { useFormDraft } from "@/src/draft/useFormDraft";
import { useRole } from "@/src/hooks/use-role";

const DEFAULT_CFG: BillingConfig = {
  discount_type: "percent",
  discount_value: 10,
  discount_min_order: 699,
};

interface CfgDraft {
  cfgModalOpen: boolean;
  tmpDiscType: DiscountType;
  tmpDiscValue: string;
  tmpDiscMin: string;
}

const CFG_DRAFT_KEY = "iminationz:billing:cfgDraft:v1";

// Modified: Force whole integer formatting globally
const fmt = (n: number) => formatINRPlain(Math.round(n));

interface CartLine {
  inv: InventoryItem;
  qty: number;
  customPrice?: number | null; // Owner-only price override for this line
}

const effectivePrice = (l: CartLine) => (l.customPrice != null ? l.customPrice : l.inv.price);

export default function BillingScreen() {
  const router = useRouter();
  const { role, loading: roleLoading } = useRole();
  const isEmployee = role === "employee";
  const isOwner = role === "owner";
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

  const [billingCfg, setBillingCfg] = useState<BillingConfig>(DEFAULT_CFG);
  const [cfgModalOpen, setCfgModalOpen] = useState(false);
  const [tmpDiscType, setTmpDiscType] = useState<DiscountType>("percent");
  const [tmpDiscValue, setTmpDiscValue] = useState("10");
  const [tmpDiscMin, setTmpDiscMin] = useState("699");
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);

  const cfgDraft = useFormDraft<CfgDraft>(CFG_DRAFT_KEY);
  const [cfgDraftHydrated, setCfgDraftHydrated] = useState(false);

  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [tempCustomerMobile, setTempCustomerMobile] = useState("");
  const [tempCustomerName, setTempCustomerName] = useState("");
  const [tempCustomerInfo, setTempCustomerInfo] = useState<CustomerInfo | null>(null);

  const [customPriceInvId, setCustomPriceInvId] = useState<string | null>(null);
  const [customPriceInput, setCustomPriceInput] = useState("");

  const draft = useDraftBilling();
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [showRestoredBanner, setShowRestoredBanner] = useState(false);
  const submitLockRef = useRef(false);

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const onConfirmLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/");
    } finally {
      setLoggingOut(false);
      setLogoutConfirmOpen(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [res, cfg] = await Promise.all([
        api.listInventory(),
        settingsApi.getBillingConfig().catch(() => DEFAULT_CFG),
      ]);
      setInventory(res);
      setBillingCfg(cfg);
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

  useEffect(() => {
    if (draftHydrated) return;
    if (loading) return;
    if (roleLoading) return;
    if (draft.restoring) return;

    if (draft.restoredDraft && draft.restoredDraft.cart.length > 0) {
      const rebuiltCart: CartLine[] = [];
      for (const line of draft.restoredDraft.cart) {
        const live = inventory.find((i) => i.id === line.inv.id);
        if (live) {
          const safeQty = Math.min(line.qty, Math.max(live.current_qty, 0));
          if (safeQty > 0) {
            // Custom pricing is owner-only — never restore an override
            // into a session that isn't currently signed in as owner
            // (e.g. a shared device where an employee logs in after).
            const restoredCustomPrice = isOwner ? line.customPrice ?? null : null;
            rebuiltCart.push({ inv: live, qty: safeQty, customPrice: restoredCustomPrice });
          }
        }
      }
      setCart(rebuiltCart);
      setCashAmount(draft.restoredDraft.cashAmount || "");
      setUpiAmount(draft.restoredDraft.upiAmount || "");
      setTempCustomerMobile(draft.restoredDraft.tempCustomerMobile || "");
      setTempCustomerName(draft.restoredDraft.tempCustomerName || "");
      setTempCustomerInfo(draft.restoredDraft.tempCustomerInfo || null);

      if (rebuiltCart.length > 0) {
        setShowRestoredBanner(true);
      }
    }
    setDraftHydrated(true);
  }, [draft.restoring, draft.restoredDraft, loading, roleLoading, isOwner, inventory, draftHydrated]);

  useEffect(() => {
    if (!draftHydrated) return;
    const draftCart: DraftCartLine[] = cart.map((l) => ({ inv: l.inv, qty: l.qty, customPrice: l.customPrice ?? null }));
    draft.scheduleSave({
      cart: draftCart,
      cashAmount,
      upiAmount,
      tempCustomerMobile,
      tempCustomerName,
      tempCustomerInfo,
    });
  }, [
    draftHydrated,
    cart,
    cashAmount,
    upiAmount,
    tempCustomerMobile,
    tempCustomerName,
    tempCustomerInfo,
  ]);

  // ---- Restore an in-progress Discount Settings edit once on mount ----
  useEffect(() => {
    if (cfgDraftHydrated || cfgDraft.restoring) return;
    if (cfgDraft.restoredDraft?.cfgModalOpen) {
      setTmpDiscType(cfgDraft.restoredDraft.tmpDiscType);
      setTmpDiscValue(cfgDraft.restoredDraft.tmpDiscValue);
      setTmpDiscMin(cfgDraft.restoredDraft.tmpDiscMin);
      setCfgModalOpen(true);
    }
    setCfgDraftHydrated(true);
  }, [cfgDraft.restoring, cfgDraft.restoredDraft, cfgDraftHydrated]);

  useEffect(() => {
    if (!cfgDraftHydrated || !cfgModalOpen) return;
    cfgDraft.scheduleSave({ cfgModalOpen, tmpDiscType, tmpDiscValue, tmpDiscMin });
  }, [cfgDraftHydrated, cfgModalOpen, tmpDiscType, tmpDiscValue, tmpDiscMin]);

  const { gross, discount, finalAmount, paid, payable, isValid, status, customSubtotal } = useMemo(() => {
    // Modified: Ensure everything stays bound strictly inside rounded integers
    let autoSubtotal = 0;
    let customSubtotal = 0;
    cart.forEach((l) => {
      const lineTotal = Math.round(effectivePrice(l) * l.qty);
      if (l.customPrice != null) customSubtotal += lineTotal;
      else autoSubtotal += lineTotal;
    });
    autoSubtotal = Math.round(autoSubtotal);
    customSubtotal = Math.round(customSubtotal);
    const gross = autoSubtotal + customSubtotal;
    let discount = 0;
    // Custom-priced items are excluded from the automatic discount —
    // it only ever applies to the catalog-priced (auto) subtotal.
    if (autoSubtotal > billingCfg.discount_min_order) {
      if (billingCfg.discount_type === "flat") {
        discount = Math.min(Math.round(billingCfg.discount_value), autoSubtotal);
      } else {
        discount = Math.round(autoSubtotal * (billingCfg.discount_value / 100));
      }
    }
    const finalAmount = Math.round(gross - discount);
    const c = parseInt(cashAmount, 10) || 0;
    const u = parseInt(upiAmount, 10) || 0;
    const paid = c + u;
    const payable = finalAmount - paid;
    const isValid = cart.length > 0 && paid === finalAmount;
    return {
      gross,
      discount,
      finalAmount,
      paid,
      payable,
      isValid,
      status: isValid ? "PAID" : "DRAFT",
      autoSubtotal,
      customSubtotal,
    };
  }, [cart, cashAmount, upiAmount, billingCfg]);

  const discountLabel =
    billingCfg.discount_type === "flat"
      ? `₹${Math.round(billingCfg.discount_value)} OFF`
      : `${billingCfg.discount_value}% OFF`;

  const openCfgModal = () => {
    setTmpDiscType(billingCfg.discount_type);
    setTmpDiscValue(String(Math.round(billingCfg.discount_value)));
    setTmpDiscMin(String(Math.round(billingCfg.discount_min_order)));
    setCfgError(null);
    setCfgModalOpen(true);
  };

  const saveCfg = async () => {
    setCfgError(null);
    const val = parseInt(tmpDiscValue, 10);
    const min = parseInt(tmpDiscMin, 10);
    if (isNaN(val) || val < 0) {
      setCfgError("Discount value must be 0 or more");
      return;
    }
    if (tmpDiscType === "percent" && val > 100) {
      setCfgError("Percentage cannot exceed 100");
      return;
    }
    if (isNaN(min) || min < 0) {
      setCfgError("Minimum order must be 0 or more");
      return;
    }
    setSavingCfg(true);
    try {
      const next: BillingConfig = {
        discount_type: tmpDiscType,
        discount_value: val,
        discount_min_order: min,
      };
      await settingsApi.updateBillingConfig(next);
      setBillingCfg(next);
      setCfgModalOpen(false);
      await cfgDraft.clearDraft();
    } catch (e: any) {
      setCfgError(e.message);
    } finally {
      setSavingCfg(false);
    }
  };

  const closeCfgModal = () => {
    setCfgModalOpen(false);
    cfgDraft.clearDraft();
  };

  // Modified: Use clean structural integers inside the live updates
  const onCashChange = (val: string) => {
    const cleaned = val.replace(/[^0-9]/g, ""); // strip decimals immediately
    setCashAmount(cleaned);
    const cashNum = parseInt(cleaned, 10) || 0;
    const remainder = finalAmount - cashNum;
    setUpiAmount(remainder === 0 ? "0" : String(remainder));
  };

  const onUpiChange = (val: string) => {
    const cleaned = val.replace(/[^0-9-]/g, ""); // keep negative placeholder sign context
    setUpiAmount(cleaned);
    const upiNum = parseInt(cleaned, 10) || 0;
    const remainder = finalAmount - upiNum;
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
    const n = parseInt(val.replace(/[^0-9]/g, "") || "0", 10);
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

  const openCustomPriceModal = (invId: string) => {
    const line = cart.find((l) => l.inv.id === invId);
    if (!line) return;
    setCustomPriceInput(String(Math.round(effectivePrice(line))));
    setCustomPriceInvId(invId);
  };

  const closeCustomPriceModal = () => setCustomPriceInvId(null);

  const saveCustomPrice = () => {
    if (!customPriceInvId) return;
    const val = parseInt(customPriceInput, 10);
    setCart((prev) =>
      prev.map((l) => (l.inv.id === customPriceInvId ? { ...l, customPrice: isNaN(val) ? null : Math.max(0, val) } : l))
    );
    setCustomPriceInvId(null);
  };

  const clearCustomPrice = () => {
    if (!customPriceInvId) return;
    setCart((prev) => prev.map((l) => (l.inv.id === customPriceInvId ? { ...l, customPrice: null } : l)));
    setCustomPriceInvId(null);
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
    setShowRestoredBanner(false);
    setCustomPriceInvId(null);
    draft.clearDraft();
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
    setTempCustomerMobile("");
    setTempCustomerName("");
    setTempCustomerInfo(null);
    setCustomerModalOpen(true);
  };

  const submit = async () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    setError(null);
    setSubmitting(true);
    try {
      const bill = await api.createBill({
        customer_mobile: tempCustomerMobile.trim() || null,
        customer_name: tempCustomerName.trim() || null,
        cash_amount: parseInt(cashAmount, 10) || 0,
        upi_amount: parseInt(upiAmount, 10) || 0,
        items: cart.map((l) => ({
          inv_id: l.inv.id,
          item_id: l.inv.item_id,
          item_name: l.inv.item_name,
          price: Math.round(effectivePrice(l)),
          qty: l.qty,
          line_total: Math.round(effectivePrice(l) * l.qty),
          custom_price: l.customPrice != null ? Math.round(l.customPrice) : null,
        })),
      });
      await draft.clearDraft();
      reset();
      setCustomerModalOpen(false);
      router.push(`/invoice/${bill.id}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((i) => {
      if (i.current_qty > 0) set.add(i.category);
    });
    return Array.from(set).sort();
  }, [inventory]);

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
        <View style={styles.header}>
          <Text style={styles.title}>New Bill</Text>
          <View style={styles.headerBtns}>
            {isOwner && (
              <Pressable
                testID="billing-config-button"
                onPress={openCfgModal}
                style={styles.resetBtn}
              >
                <Ionicons name="settings-outline" size={18} color={theme.color.onSurface} />
              </Pressable>
            )}
            <Pressable testID="reset-bill" onPress={reset} style={styles.resetBtn}>
              <Ionicons name="refresh" size={18} color={theme.color.onSurface} />
            </Pressable>
            {isEmployee && (
              <Pressable
                testID="logout-button"
                onPress={() => setLogoutConfirmOpen(true)}
                style={styles.resetBtn}
              >
                <Ionicons name="log-out-outline" size={18} color={theme.color.error} />
              </Pressable>
            )}
          </View>
        </View>

        {showRestoredBanner && (
          <View testID="draft-restored-banner" style={styles.draftBanner}>
            <Ionicons name="time-outline" size={15} color={theme.color.brandPrimary} />
            <Text style={styles.draftBannerText}>
              Restored your in-progress bill
            </Text>
            <Pressable
              testID="draft-restored-dismiss"
              onPress={() => setShowRestoredBanner(false)}
              hitSlop={8}
            >
              <Ionicons name="close" size={16} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          </View>
        )}

        <View style={{ flex: 1, display: "flex", flexDirection: "column" }}>
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
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                        <Text style={styles.lineName}>{l.inv.item_name}</Text>
                        {l.customPrice != null && (
                          <View testID={`custom-price-tag-${l.inv.item_id}`} style={styles.customTag}>
                            <Text style={styles.customTagText}>Custom</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.lineSub}>
                        {fmt(effectivePrice(l))} · stock{" "}
                        <Text
                          style={{
                            color:
                              l.inv.current_qty <= 5
                                ? theme.color.error
                                : theme.color.success,
                            fontWeight: "700",
                          }}
                        >
                          {l.inv.current_qty}
                        </Text>
                      </Text>
                    </View>
                    {isOwner && (
                      <Pressable
                        testID={`edit-price-${l.inv.item_id}`}
                        onPress={() => openCustomPriceModal(l.inv.id)}
                        hitSlop={8}
                        style={styles.editPriceBtn}
                      >
                        <Ionicons name="pricetag-outline" size={16} color={theme.color.brandPrimary} />
                      </Pressable>
                    )}
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
                    <Text style={styles.lineTotal}>{fmt(effectivePrice(l) * l.qty)}</Text>
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

        <View style={styles.paymentPanel}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gross</Text>
            <Text style={styles.summaryValue}>{fmt(gross)}</Text>
          </View>
          {discount > 0 && (
            <View style={styles.summaryRow}>
              <View style={styles.discountTag}>
                <Text style={styles.discountTagText}>{discountLabel}</Text>
              </View>
              <Text style={[styles.summaryValue, { color: theme.color.warning }]}>
                -{fmt(discount)}
              </Text>
            </View>
          )}
          {customSubtotal > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.lineSub} testID="custom-subtotal-note">
                Includes {fmt(customSubtotal)} custom-priced (excluded from discount)
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
                keyboardType="number-pad"
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
                keyboardType="number-pad"
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

        <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={closePicker}>
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
                            {
                              backgroundColor:
                                item.current_qty <= 5
                                  ? theme.color.error
                                  : theme.color.success,
                            },
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

              <Pressable testID="picker-done" onPress={closePicker} style={styles.pickerDoneBtn}>
                <Text style={styles.pickerDoneText}>
                  {totalPickerItems > 0 ? `Done (${totalPickerItems} item${totalPickerItems > 1 ? "s" : ""})` : "Done"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={customerModalOpen} animationType="slide" transparent onRequestClose={() => setCustomerModalOpen(false)}>
          <View style={styles.customerModalBackdrop}>
            <View style={styles.customerModalContent}>
              <View style={styles.customerModalHeader}>
                <Text style={styles.customerModalTitle}>Customer Details</Text>
                <Pressable testID="close-customer-modal" onPress={() => setCustomerModalOpen(false)} disabled={submitting}>
                  <Ionicons name="close" size={24} color={theme.color.onSurface} />
                </Pressable>
              </View>

              <View style={styles.customerModalBody}>
                <Text style={styles.label}>Mobile Number (optional)</Text>
                <TextInput
                  testID="customer-mobile-modal-input"
                  value={tempCustomerMobile}
                  onChangeText={(v) => setTempCustomerMobile(v.replace(/[^0-9]/g, ""))}
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

                {error && (
                  <View style={{ marginTop: theme.spacing.md }}>
                    <Text testID="customer-modal-error" style={styles.error}>
                      {error}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.customerModalActions}>
                <Pressable style={[styles.cancelBtn, submitting && { opacity: 0.5 }]} onPress={() => setCustomerModalOpen(false)} disabled={submitting}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.submitBtn, (!isValid || submitting) && { opacity: 0.5 }]} onPress={submit} disabled={!isValid || submitting}>
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

        {isOwner && (
          <Modal visible={cfgModalOpen} transparent animationType="slide" onRequestClose={closeCfgModal}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
              <View style={styles.customerModalBackdrop}>
                <View style={styles.customerModalContent}>
                  <View style={styles.customerModalHeader}>
                    <Text style={styles.customerModalTitle}>Discount Settings</Text>
                    <Pressable testID="close-cfg-modal" onPress={closeCfgModal} disabled={savingCfg}>
                      <Ionicons name="close" size={24} color={theme.color.onSurface} />
                    </Pressable>
                  </View>

                  <View style={styles.customerModalBody}>
                    <Text style={styles.label}>Discount Type</Text>
                    <View style={styles.segmented}>
                      <Pressable testID="disc-type-percent" onPress={() => setTmpDiscType("percent")} style={[styles.segBtn, tmpDiscType === "percent" && styles.segBtnActive]}>
                        <Text style={[styles.segBtnText, tmpDiscType === "percent" && styles.segBtnTextActive]}>Percentage (%)</Text>
                      </Pressable>
                      <Pressable testID="disc-type-flat" onPress={() => setTmpDiscType("flat")} style={[styles.segBtn, tmpDiscType === "flat" && styles.segBtnActive]}>
                        <Text style={[styles.segBtnText, tmpDiscType === "flat" && styles.segBtnTextActive]}>Flat (₹)</Text>
                      </Pressable>
                    </View>

                    <Text style={[styles.label, { marginTop: theme.spacing.lg }]}>
                      {tmpDiscType === "percent" ? "Discount %" : "Discount Amount (₹)"}
                    </Text>
                    <TextInput
                      testID="disc-value-input"
                      value={tmpDiscValue}
                      onChangeText={(v) => setTmpDiscValue(v.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                      placeholder={tmpDiscType === "percent" ? "10" : "100"}
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.input}
                    />

                    <Text style={[styles.label, { marginTop: theme.spacing.lg }]}>
                      Minimum Order Amount (₹) — discount applies when gross exceeds this
                    </Text>
                    <TextInput
                      testID="disc-min-input"
                      value={tmpDiscMin}
                      onChangeText={(v) => setTmpDiscMin(v.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                      placeholder="699"
                      placeholderTextColor={theme.color.onSurfaceTertiary}
                      style={styles.input}
                    />

                    <View style={styles.cfgPreview}>
                      <Text style={styles.cfgPreviewText}>
                        Preview: Bills above ₹{tmpDiscMin || 0} get{" "}
                        {tmpDiscType === "percent"
                          ? `${tmpDiscValue || 0}% off`
                          : `₹${tmpDiscValue || 0} off`}
                      </Text>
                    </View>

                    {cfgError && (
                      <Text testID="cfg-error" style={[styles.error, { marginTop: theme.spacing.md }]}>
                        {cfgError}
                      </Text>
                    )}
                  </View>

                  <View style={styles.customerModalActions}>
                    <Pressable style={[styles.cancelBtn, savingCfg && { opacity: 0.5 }]} onPress={closeCfgModal} disabled={savingCfg}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable testID="save-cfg-button" style={[styles.submitBtn, savingCfg && { opacity: 0.5 }]} onPress={saveCfg} disabled={savingCfg}>
                      {savingCfg ? (
                        <ActivityIndicator color={theme.color.onBrandPrimary} />
                      ) : (
                        <>
                          <Ionicons name="save" size={18} color={theme.color.onBrandPrimary} />
                          <Text style={styles.submitBtnText}>Save</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {isEmployee && (
          <Modal visible={logoutConfirmOpen} transparent animationType="fade" onRequestClose={() => setLogoutConfirmOpen(false)}>
            <View style={styles.logoutOverlay}>
              <View style={styles.logoutBox}>
                <Ionicons name="log-out-outline" size={28} color={theme.color.error} />
                <Text style={styles.logoutTitle}>Log out?</Text>
                <Text style={styles.logoutBody}>
                  You'll need to sign in again to create bills.
                  {cart.length > 0 ? " Your current draft bill will be saved and restored next time you log in." : ""}
                </Text>
                <View style={styles.logoutActions}>
                  <Pressable testID="logout-cancel" onPress={() => setLogoutConfirmOpen(false)} disabled={loggingOut} style={[styles.cancelBtn, loggingOut && { opacity: 0.5 }]}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable testID="logout-confirm" onPress={onConfirmLogout} disabled={loggingOut} style={[styles.logoutConfirmBtn, loggingOut && { opacity: 0.5 }]}>
                    {loggingOut ? <ActivityIndicator color="#fff" /> : <Text style={styles.logoutConfirmBtnText}>Log Out</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {isOwner && (
          <Modal
            visible={!!customPriceInvId}
            transparent
            animationType="fade"
            onRequestClose={closeCustomPriceModal}
          >
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.logoutOverlay}>
              <View style={[styles.logoutBox, { alignItems: "stretch" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.sm }}>
                  <Text style={styles.logoutTitle}>Custom Price</Text>
                  <Pressable testID="close-custom-price-modal" onPress={closeCustomPriceModal}>
                    <Ionicons name="close" size={22} color={theme.color.onSurface} />
                  </Pressable>
                </View>
                <Text style={styles.label}>
                  Give this item at any amount — excluded from auto-discount
                </Text>
                <TextInput
                  testID="custom-price-input"
                  value={customPriceInput}
                  onChangeText={(v) => setCustomPriceInput(v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={[styles.input, { marginTop: theme.spacing.sm }]}
                  autoFocus
                />
                <View style={[styles.logoutActions, { marginTop: theme.spacing.md }]}>
                  <Pressable testID="clear-custom-price" onPress={clearCustomPrice} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Reset to Catalog</Text>
                  </Pressable>
                  <Pressable testID="save-custom-price" onPress={saveCustomPrice} style={styles.logoutConfirmBtn}>
                    <Text style={styles.logoutConfirmBtnText}>Apply</Text>
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Styles object remains completely preserved from original styling architecture
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
  headerBtns: { flexDirection: "row", gap: theme.spacing.sm },
  resetBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  draftBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.brandTertiary,
    borderBottomColor: theme.color.brandPrimary,
    borderBottomWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
  },
  draftBannerText: {
    flex: 1,
    color: theme.color.brandPrimary,
    fontSize: 12,
    fontWeight: "700",
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
  customTag: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.brandTertiary,
  },
  customTagText: {
    color: theme.color.brandPrimary,
    fontSize: 10,
    fontWeight: "700",
  },
  editPriceBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
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
  logoutOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  logoutBox: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderColor: theme.color.border,
    borderWidth: 1,
    padding: theme.spacing.xl,
    alignItems: "center",
  },
  logoutTitle: {
    color: theme.color.onSurface,
    fontSize: 18,
    fontWeight: "700",
    marginTop: theme.spacing.sm,
  },
  logoutBody: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 13,
    textAlign: "center",
    marginTop: theme.spacing.sm,
    lineHeight: 18,
  },
  logoutActions: {
    flexDirection: "row",
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
    width: "100%",
  },
  logoutConfirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.error,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutConfirmBtnText: {
    color: "#fff",
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
  segmented: {
    flexDirection: "row",
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 4,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  segBtnActive: {
    backgroundColor: theme.color.brandPrimary,
  },
  segBtnText: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  segBtnTextActive: {
    color: theme.color.onBrandPrimary,
    fontWeight: "800",
  },
  cfgPreview: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    borderRadius: theme.radius.md,
  },
  cfgPreviewText: {
    color: theme.color.brandPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
});
