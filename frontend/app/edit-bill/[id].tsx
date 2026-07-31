import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, Bill, InventoryItem } from "@/src/api/client";
import { getInventory } from "@/src/api/cache";
import { theme, formatINRPlain } from "@/src/theme";
import { useRole } from "@/src/hooks/use-role";

const fmt = (n: number) => formatINRPlain(Math.round(n));

interface EditLine {
  invId: string;
  itemId: string;
  itemName: string;
  price: number; // effective price used for this line (may be a custom override)
  originalPrice: number; // inventory's current price, for reference/reset
  qty: number;
  // Stock available to allocate to THIS line, already accounting for the
  // fact that this bill previously held some qty of this same item (which
  // was virtually "returned" the moment editing started).
  availableForLine: number;
}

export default function EditBillScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role } = useRole();
  const isEmployee = role === "employee";

  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState<Bill | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [cashAmount, setCashAmount] = useState("0");
  const [upiAmount, setUpiAmount] = useState("0");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        const [b, inv] = await Promise.all([api.getBill(id), getInventory()]);
        setBill(b);
        setInventory(inv);
        setCustomerMobile(b.customer_mobile || "");
        setCustomerName(b.customer_name || "");
        setCashAmount(String(Math.round(b.cash_amount)));
        setUpiAmount(String(Math.round(b.upi_amount)));

        // Build editable lines from the bill's existing items. Stock shown
        // as "available" already adds back this bill's own qty, since that
        // stock is conceptually returned the moment you start editing.
        const invById = new Map(inv.map((i) => [i.id, i]));
        const builtLines: EditLine[] = b.items.map((bi) => {
          const invItem = bi.inv_id ? invById.get(bi.inv_id) : undefined;
          const currentStock = invItem ? invItem.current_qty : 0;
          return {
            invId: bi.inv_id || "",
            itemId: bi.item_id,
            itemName: bi.item_name,
            price: bi.price,
            originalPrice: invItem ? invItem.price : bi.price,
            qty: bi.qty,
            availableForLine: currentStock + bi.qty,
          };
        });
        setLines(builtLines);
      } catch (e: any) {
        setError(e.message || "Couldn't load bill");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const gross = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const cashNum = parseInt(cashAmount, 10) || 0;
  const upiNum = parseInt(upiAmount, 10) || 0;
  const paid = cashNum + upiNum;

  const filteredInventory = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return inventory
      .filter(
        (i) =>
          i.current_qty > 0 &&
          (i.item_name.toLowerCase().includes(q) || i.item_id.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [inventory, search]);

  const addItem = (inv: InventoryItem) => {
    setSearch("");
    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.invId === inv.id);
      if (existingIdx >= 0) {
        const copy = [...prev];
        const line = copy[existingIdx];
        if (line.qty + 1 > line.availableForLine) {
          setError(`Only ${line.availableForLine} in stock for ${inv.item_name}`);
          return prev;
        }
        copy[existingIdx] = { ...line, qty: line.qty + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          invId: inv.id,
          itemId: inv.item_id,
          itemName: inv.item_name,
          price: inv.price,
          originalPrice: inv.price,
          qty: 1,
          availableForLine: inv.current_qty,
        },
      ];
    });
    setError(null);
  };

  const updateQty = (invId: string, delta: number) => {
    setError(null);
    setLines((prev) =>
      prev
        .map((l) => {
          if (l.invId !== invId) return l;
          const nextQty = l.qty + delta;
          if (nextQty <= 0) return { ...l, qty: 0 };
          if (nextQty > l.availableForLine) {
            setError(`Only ${l.availableForLine} in stock for ${l.itemName}`);
            return l;
          }
          return { ...l, qty: nextQty };
        })
        .filter((l) => l.qty > 0)
    );
  };

  const removeLine = (invId: string) => {
    setError(null);
    setLines((prev) => prev.filter((l) => l.invId !== invId));
  };

  const isValid = lines.length > 0 && paid === gross && gross >= 0;

  const handleSave = async () => {
    if (!bill) return;
    if (lines.length === 0) {
      setError("Bill must have at least one item");
      return;
    }
    if (paid !== gross) {
      setError(`Cash + UPI (${fmt(paid)}) must equal Total (${fmt(gross)})`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.editBill({
        bill_id: bill.id,
        customer_mobile: customerMobile.trim() || null,
        customer_name: customerName.trim() || null,
        items: lines.map((l) => ({
          inv_id: l.invId,
          qty: l.qty,
          custom_price: l.price !== l.originalPrice ? l.price : null,
        })),
        cash_amount: cashNum,
        upi_amount: upiNum,
      });
      router.back();
    } catch (e: any) {
      setError(e.message || "Couldn't save changes");
    } finally {
      setSubmitting(false);
    }
  };

  if (isEmployee) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Ionicons name="lock-closed-outline" size={32} color={theme.color.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Only the owner can edit a completed bill.</Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator color={theme.color.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!bill) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.emptyText}>{error || "Bill not found"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable testID="edit-bill-back" onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Edit Bill</Text>
          <Text style={styles.subtitle}>{bill.bill_number}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Customer</Text>
        <TextInput
          testID="edit-bill-mobile"
          value={customerMobile}
          onChangeText={(v) => setCustomerMobile(v.replace(/[^0-9]/g, ""))}
          placeholder="Mobile number (optional)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          keyboardType="phone-pad"
          style={styles.input}
          maxLength={15}
        />
        <TextInput
          testID="edit-bill-name"
          value={customerName}
          onChangeText={setCustomerName}
          placeholder="Customer name (optional)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          style={[styles.input, { marginTop: theme.spacing.sm }]}
        />

        <Text style={[styles.sectionLabel, { marginTop: theme.spacing.lg }]}>Add Item</Text>
        <TextInput
          testID="edit-bill-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search item to add"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          style={styles.input}
        />
        {filteredInventory.length > 0 && (
          <View style={styles.searchResults}>
            {filteredInventory.map((inv) => (
              <Pressable
                key={inv.id}
                testID={`edit-bill-add-${inv.item_id}`}
                onPress={() => addItem(inv)}
                style={styles.searchResultRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.searchResultName}>{inv.item_name}</Text>
                  <Text style={styles.searchResultSub}>
                    {fmt(inv.price)} · stock {inv.current_qty}
                  </Text>
                </View>
                <Ionicons name="add-circle-outline" size={20} color={theme.color.brandPrimary} />
              </Pressable>
            ))}
          </View>
        )}

        <Text style={[styles.sectionLabel, { marginTop: theme.spacing.lg }]}>
          Items ({lines.length})
        </Text>
        {lines.length === 0 ? (
          <Text style={styles.emptyText}>No items — add at least one above.</Text>
        ) : (
          lines.map((l) => (
            <View key={l.invId} style={styles.line} testID={`edit-bill-line-${l.itemId}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName}>{l.itemName}</Text>
                <Text style={styles.lineSub}>
                  {fmt(l.price)} · up to {l.availableForLine} available
                </Text>
              </View>
              <View style={styles.qtyBox}>
                <Pressable
                  testID={`edit-bill-qty-dec-${l.itemId}`}
                  onPress={() => updateQty(l.invId, -1)}
                  style={styles.qtyBtn}
                >
                  <Ionicons name="remove" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Text style={styles.qtyText}>{l.qty}</Text>
                <Pressable
                  testID={`edit-bill-qty-inc-${l.itemId}`}
                  onPress={() => updateQty(l.invId, 1)}
                  style={styles.qtyBtn}
                >
                  <Ionicons name="add" size={16} color={theme.color.onSurface} />
                </Pressable>
              </View>
              <Text style={styles.lineTotal}>{fmt(l.price * l.qty)}</Text>
              <Pressable testID={`edit-bill-remove-${l.itemId}`} onPress={() => removeLine(l.invId)} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={theme.color.error} />
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total</Text>
            <Text style={styles.summaryValue}>{fmt(gross)}</Text>
          </View>

          <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Cash</Text>
              <TextInput
                testID="edit-bill-cash"
                value={cashAmount}
                onChangeText={setCashAmount}
                keyboardType="number-pad"
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>UPI</Text>
              <TextInput
                testID="edit-bill-upi"
                value={upiAmount}
                onChangeText={setUpiAmount}
                keyboardType="number-pad"
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Paid</Text>
            <Text
              style={[
                styles.summaryValue,
                { color: paid === gross ? theme.color.success : theme.color.error },
              ]}
            >
              {fmt(paid)}
            </Text>
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text testID="edit-bill-error" style={styles.errorText}>
              {error}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          testID="edit-bill-save"
          onPress={handleSave}
          disabled={!isValid || submitting}
          style={[styles.saveBtn, (!isValid || submitting) && { opacity: 0.5 }]}
        >
          {submitting ? (
            <ActivityIndicator color={theme.color.onBrandPrimary} />
          ) : (
            <Text style={styles.saveBtnText}>Save Changes</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  centerContent: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, padding: theme.spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  title: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  subtitle: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: theme.color.onSurfaceSecondary,
    textTransform: "uppercase",
    marginBottom: theme.spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.color.onSurface,
    backgroundColor: theme.color.surfaceSecondary,
  },
  searchResults: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    overflow: "hidden",
  },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.md,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  searchResultName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  searchResultSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: 10,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  lineName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  lineSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  lineTotal: { fontSize: 14, fontWeight: "800", color: theme.color.brandPrimary, minWidth: 60, textAlign: "right" },
  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, minWidth: 16, textAlign: "center" },
  summaryBox: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: theme.spacing.sm,
  },
  summaryLabel: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary },
  summaryValue: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.color.onSurfaceTertiary,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  errorBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: "#FBE9E7",
  },
  errorText: { color: theme.color.error, fontSize: 13, fontWeight: "600" },
  emptyText: { color: theme.color.onSurfaceTertiary, fontSize: 13, textAlign: "center" },
  backLink: { marginTop: theme.spacing.sm },
  backLinkText: { color: theme.color.brandPrimary, fontWeight: "700" },
  footer: {
    padding: theme.spacing.lg,
    borderTopColor: theme.color.divider,
    borderTopWidth: 1,
    backgroundColor: theme.color.surface,
  },
  saveBtn: {
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  saveBtnText: { color: theme.color.onBrandPrimary, fontWeight: "800", fontSize: 15 },
});
