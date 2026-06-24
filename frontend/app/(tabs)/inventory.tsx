import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, InventoryItem } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

interface FormState {
  id?: string;
  item_id: string;
  category: string;
  item_name: string;
  price: string;
  cost_price: string;
  opening_qty: string;
  current_qty: string;
}

const EMPTY: FormState = {
  item_id: "",
  category: "",
  item_name: "",
  price: "",
  cost_price: "",
  opening_qty: "",
  current_qty: "",
};

export default function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listInventory();
      setItems(res);
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

  const categories = useMemo(() => {
    const cats = Array.from(new Set(items.map((i) => i.category))).sort();
    return ["All", ...cats];
  }, [items]);

  const filtered = items.filter((i) => {
    const matchCat = category === "All" || i.category === category;
    const s = search.toLowerCase().trim();
    const matchSearch =
      s === "" ||
      i.item_name.toLowerCase().includes(s) ||
      i.item_id.toLowerCase().includes(s) ||
      i.category.toLowerCase().includes(s);
    return matchCat && matchSearch;
  });

  const openCreate = () => {
    setForm(EMPTY);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (it: InventoryItem) => {
    setForm({
      id: it.id,
      item_id: it.item_id,
      category: it.category,
      item_name: it.item_name,
      price: String(it.price),
      cost_price: String(it.cost_price || 0),
      opening_qty: String(it.opening_qty),
      current_qty: String(it.current_qty),
    });
    setError(null);
    setModalOpen(true);
  };

  const save = async () => {
    setError(null);
    if (!form.item_id || !form.category || !form.item_name || !form.price || !form.opening_qty) {
      setError("All fields except current qty are required");
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        await api.updateInventory(form.id, {
          category: form.category,
          item_name: form.item_name,
          price: parseFloat(form.price),
          cost_price: parseFloat(form.cost_price || "0") || 0,
          opening_qty: parseInt(form.opening_qty || "0", 10),
          current_qty: parseInt(form.current_qty || form.opening_qty, 10),
        });
      } else {
        await api.createInventory({
          item_id: form.item_id,
          category: form.category,
          item_name: form.item_name,
          price: parseFloat(form.price),
          cost_price: parseFloat(form.cost_price || "0") || 0,
          opening_qty: parseInt(form.opening_qty || "0", 10),
          current_qty: parseInt(form.current_qty || form.opening_qty, 10),
        });
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (it: InventoryItem) => {
    try {
      await api.deleteInventory(it.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Inventory</Text>
          <Text style={styles.subtitle}>{items.length} items · {items.filter((i) => i.current_qty <= 5).length} low stock</Text>
        </View>
        <Pressable testID="add-inventory-button" onPress={openCreate} style={styles.addBtn}>
          <Ionicons name="add" size={22} color={theme.color.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
          <TextInput
            testID="inventory-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search items"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.searchInput}
          />
        </View>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {categories.map((c) => {
            const active = c === category;
            return (
              <Pressable
                key={c}
                testID={`category-chip-${c}`}
                onPress={() => setCategory(c)}
                style={[
                  styles.chip,
                  { borderColor: active ? theme.color.brandPrimary : theme.color.border },
                ]}
              >
                <Text style={{ color: active ? theme.color.brandPrimary : theme.color.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>
                  {c}
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
          data={filtered}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: theme.spacing.sm }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 48 }}>
              <Ionicons name="cube-outline" size={42} color={theme.color.onSurfaceTertiary} />
              <Text style={{ color: theme.color.onSurfaceTertiary, marginTop: 8 }}>
                No items. Tap + to add.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const low = item.current_qty <= 5;
            return (
              <View testID={`inv-row-${item.item_id}`} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={styles.rowName}>{item.item_name}</Text>
                    {low && (
                      <View style={styles.lowBadge}>
                        <Ionicons name="warning" size={11} color="#fff" />
                        <Text style={styles.lowBadgeText}>Low Stock</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowSub}>
                    {item.category} · {item.item_id} · {formatINRPlain(item.price)}
                    {item.cost_price > 0 ? ` · cost ${formatINRPlain(item.cost_price)}` : ""}
                  </Text>
                  <Text style={styles.rowQty}>
                    Stock {item.current_qty} / {item.opening_qty} · Sold {item.sold_qty}
                  </Text>
                </View>
                <Pressable testID={`edit-${item.item_id}`} onPress={() => openEdit(item)} style={styles.iconBtn}>
                  <Ionicons name="pencil" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable testID={`del-${item.item_id}`} onPress={() => del(item)} style={styles.iconBtn}>
                  <Ionicons name="trash" size={16} color={theme.color.error} />
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{form.id ? "Edit Item" : "New Item"}</Text>
                  <Pressable testID="close-inv-modal" onPress={() => setModalOpen(false)}>
                    <Ionicons name="close" size={24} color={theme.color.onSurface} />
                  </Pressable>
                </View>

                <Field
                  label="Item ID"
                  value={form.item_id}
                  onChangeText={(v) => setForm({ ...form, item_id: v })}
                  testID="form-item-id"
                  editable={!form.id}
                  autoCapitalize="characters"
                  placeholder="PENDANT250"
                />
                <Field
                  label="Category"
                  value={form.category}
                  onChangeText={(v) => setForm({ ...form, category: v })}
                  testID="form-category"
                  placeholder="Pendant"
                />
                <Field
                  label="Item Name"
                  value={form.item_name}
                  onChangeText={(v) => setForm({ ...form, item_name: v })}
                  testID="form-item-name"
                  placeholder="Pendant 250"
                />
                <Field
                  label="Price (₹)"
                  value={form.price}
                  onChangeText={(v) => setForm({ ...form, price: v })}
                  testID="form-price"
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Cost Price (₹) — for profit analytics"
                  value={form.cost_price}
                  onChangeText={(v) => setForm({ ...form, cost_price: v })}
                  testID="form-cost-price"
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Opening Qty"
                  value={form.opening_qty}
                  onChangeText={(v) => setForm({ ...form, opening_qty: v })}
                  testID="form-opening-qty"
                  keyboardType="number-pad"
                />
                {form.id && (
                  <Field
                    label="Current Qty"
                    value={form.current_qty}
                    onChangeText={(v) => setForm({ ...form, current_qty: v })}
                    testID="form-current-qty"
                    keyboardType="number-pad"
                  />
                )}

                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable
                  testID="save-inventory"
                  onPress={save}
                  disabled={saving}
                  style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                >
                  {saving ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <Text style={styles.saveText}>{form.id ? "Update" : "Create"}</Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({
  label,
  testID,
  ...props
}: any) {
  return (
    <View style={{ marginTop: theme.spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        placeholderTextColor={theme.color.onSurfaceTertiary}
        style={styles.input}
        {...props}
      />
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
  subtitle: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
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
  rowName: { color: theme.color.onSurface, fontWeight: "700", fontSize: 15 },
  rowSub: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  rowQty: { color: theme.color.brandPrimary, fontSize: 12, marginTop: 4, fontWeight: "600" },
  lowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: theme.color.error,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  lowBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.color.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: theme.color.surface,
    maxHeight: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopColor: theme.color.brandPrimary,
    borderTopWidth: 1,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  label: { color: theme.color.onSurfaceTertiary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
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
  error: { color: theme.color.error, marginTop: theme.spacing.md },
  saveBtn: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.color.brandPrimary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  saveText: { color: theme.color.onBrandPrimary, fontWeight: "800", fontSize: 16 },
});
