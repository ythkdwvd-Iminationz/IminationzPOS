import { useCallback, useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { expensesApi, Expense, ExpenseOverview, ExpenseItem, formatDisplayDate } from "@/src/api/client";
import { DateRangeModal } from "./sales";
import { theme, formatINRPlain } from "@/src/theme";

type Source = "personal" | "business" | "both";
type DateFilter = "all" | "today" | "month" | "custom";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayISO = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const monthStartISO = () => {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

const normalizeDate = (val: string | null | undefined): string => {
  if (!val) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const tIndex = val.indexOf("T");
  if (tIndex > 0) return val.slice(0, tIndex);
  const spaceIndex = val.indexOf(" ");
  if (spaceIndex > 0) return val.slice(0, spaceIndex);
  return val;
};

const FILTERS: { id: DateFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom" },
];

export default function ExpensesScreen() {
  const [overview, setOverview] = useState<ExpenseOverview | null>(null);
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formModalConfig, setFormModalConfig] = useState<{ open: boolean; targetExpense?: Expense }>({ open: false });
  const [fundOpen, setFundOpen] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);

  const [filter, setFilter] = useState<DateFilter>("all");
  const [rangeStart, setRangeStart] = useState<string>(monthStartISO());
  const [rangeEnd, setRangeEnd] = useState<string>(todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const [ov, list] = await Promise.all([
        expensesApi.overview(),
        expensesApi.list(),
      ]);
      setOverview(ov);
      setItems(list);
    } catch (e: any) {
      setError(e.message || "Failed to load expenses");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filteredItems = useMemo(() => {
    let out = items;
    if (filter === "today") {
      const t = todayISO();
      out = out.filter((e) => normalizeDate(e.expense_date) === t);
    } else if (filter === "month") {
      const m = monthStartISO();
      const t = todayISO();
      out = out.filter((e) => {
        const d = normalizeDate(e.expense_date);
        return d >= m && d <= t;
      });
    } else if (filter === "custom") {
      out = out.filter((e) => {
        const d = normalizeDate(e.expense_date);
        return d >= rangeStart && d <= rangeEnd;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((e) => {
        const title = (e.parent_name || "").toLowerCase();
        const note = (e.note || "").toLowerCase();
        const amt = String(e.total_amount || e.amount);
        return title.includes(q) || note.includes(q) || amt.includes(q);
      });
    }
    return out;
  }, [items, filter, rangeStart, rangeEnd, search]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Expenses</Text>
          <Text style={styles.subtitle}>
            {overview ? `${overview.entries} entries · ${formatINRPlain(overview.total_expenses)} spent` : "Track structural spends"}
          </Text>
        </View>
        <Pressable onPress={() => setFundOpen(true)} style={styles.iconBtn}>
          <Ionicons name="settings-outline" size={20} color={theme.color.onSurface} />
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
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brandPrimary} />
          }
        >
          {error && <Text style={styles.errText}>{error}</Text>}

          {overview && (
            <>
              <View style={styles.summaryRow}>
                <SummaryCard label="Personal Balance" fund={overview.personal_fund_total} spent={overview.personal_spent} balance={overview.personal_balance} color={theme.color.brandPrimary} icon="person-circle-outline" />
                <SummaryCard label="Business Balance" fund={overview.business_fund_total} spent={overview.business_spent} balance={overview.business_balance} color={theme.color.success} icon="briefcase-outline" />
              </View>
              <View style={styles.totalCard}>
                <View>
                  <Text style={styles.totalLabel}>Total Expenses</Text>
                  <Text style={styles.totalValue}>{formatINRPlain(overview.total_expenses)}</Text>
                </View>
                <View style={styles.totalMeta}>
                  <Text style={styles.totalMetaText}>Personal {formatINRPlain(overview.personal_spent)}</Text>
                  <Text style={styles.totalMetaText}>Business {formatINRPlain(overview.business_spent)}</Text>
                </View>
              </View>
            </>
          )}

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Recent Entries</Text>
            <Text style={styles.listCount}>{filteredItems.length}</Text>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search by description or amount" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.searchInput} />
          </View>

          <View style={{ height: 45, marginTop: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {FILTERS.map((f) => {
                const active = f.id === filter;
                return (
                  <Pressable key={f.id} onPress={() => { setFilter(f.id); if (f.id === "custom") setPickerOpen(true); }} style={[styles.chip, { borderColor: active ? theme.color.brandPrimary : theme.color.border, backgroundColor: active ? theme.color.brandTertiary : theme.color.surfaceSecondary }]}>
                    <Text style={{ color: active ? theme.color.brandPrimary : theme.color.onSurfaceSecondary, fontSize: 12, fontWeight: "700" }}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {filteredItems.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="wallet-outline" size={42} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.emptyText}>No matching logs located</Text>
            </View>
          ) : (
            filteredItems.map((it) => (
              <Pressable key={it.id} style={styles.row} onPress={() => setDetail(it)}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.color.onSurface, fontWeight: "700", fontSize: 16 }}>{it.parent_name}</Text>
                    <Text style={styles.rowAmount}>{formatINRPlain(it.total_amount || it.amount)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                    <Text style={styles.rowMeta}>{formatDisplayDate(it.expense_date)}</Text>
                    <SourcePill source={it.source} />
                  </View>
                  {it.items && it.items.length > 0 && (
                    <Text style={{ fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 4 }}>Contains {it.items.length} item items</Text>
                  )}
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <Pressable onPress={() => setFormModalConfig({ open: true })} style={styles.fab}>
        <Ionicons name="add" size={28} color={theme.color.onBrandPrimary} />
      </Pressable>

      {formModalConfig.open && (
        <ExpenseFormBatchModal
          visible={formModalConfig.open}
          targetExpense={formModalConfig.targetExpense}
          onClose={() => setFormModalConfig({ open: false })}
          onSaved={() => { setFormModalConfig({ open: false }); load(); }}
        />
      )}

      <SetFundModal visible={fundOpen} current={overview?.personal_fund_total ?? 200000} onClose={() => setFundOpen(false)} onSaved={() => { setFundOpen(false); load(); }} />
      <DateRangeModal visible={pickerOpen} start={rangeStart} end={rangeEnd} onCancel={() => setPickerOpen(false)} onApply={(s, e) => { setRangeStart(s); setRangeEnd(e); setPickerOpen(false); }} />
      
      {detail && (
        <ExpenseDetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onEditRequested={(target) => {
            setDetail(null);
            setFormModalConfig({ open: true, targetExpense: target });
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ---------------- Structural Form & Batch Builder Modal ---------------- */
function ExpenseFormBatchModal({
  visible,
  targetExpense,
  onClose,
  onSaved,
}: {
  visible: boolean;
  targetExpense?: Expense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!targetExpense;
  const [parentName, setParentName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  const [childItems, setChildItems] = useState<ExpenseItem[]>([]);
  
  const [cAmount, setCAmount] = useState("");
  const [cSource, setCSource] = useState<Source>("business");
  const [cPersonalAmt, setCPersonalAmt] = useState("");
  const [cBusinessAmt, setCBusinessAmt] = useState("");
  const [cNote, setCNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing && targetExpense) {
      setParentName(targetExpense.parent_name);
      setDate(normalizeDate(targetExpense.expense_date));
      setChildItems(targetExpense.items || []);
    } else {
      setParentName("");
      setDate(todayISO());
      setChildItems([]);
    }
  }, [isEditing, targetExpense]);

  const totals = useMemo(() => {
    return childItems.reduce((acc, curr) => {
      acc.total += curr.amount;
      acc.personal += curr.personal_amount;
      acc.business += curr.business_amount;
      return acc;
    }, { total: 0, personal: 0, business: 0 });
  }, [childItems]);

  const parentSourceDetermined = useMemo<Source>(() => {
    if (totals.personal > 0 && totals.business > 0) return "both";
    if (totals.personal > 0) return "personal";
    return "business";
  }, [totals]);

  const handleAddChild = () => {
    const amt = Number(cAmount) || 0;
    if (amt <= 0) return;
    
    let pAmt = cSource === "personal" ? amt : cSource === "both" ? Number(cPersonalAmt) || 0 : 0;
    let bAmt = cSource === "business" ? amt : cSource === "both" ? Number(cBusinessAmt) || 0 : 0;

    if (cSource === "both" && Math.abs(pAmt + bAmt - amt) > 0.01) {
      alert("Child calculation mismatch. Internal split values must perfectly match total component item cost.");
      return;
    }

    const newItem: ExpenseItem = {
      amount: amt,
      source: cSource,
      personal_amount: pAmt,
      business_amount: bAmt,
      note: cNote.trim() || null
    };

    setChildItems([...childItems, newItem]);
    setCAmount("");
    setCPersonalAmt("");
    setCBusinessAmt("");
    setCNote("");
  };

  const handleRemoveChild = (index: number) => {
    setChildItems(childItems.filter((_, i) => i !== index));
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    // Dismiss picker overlay directly on Android
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    
    if (event.type === "set" && selectedDate) {
      const yyyy = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, "0");
      const dd = String(selectedDate.getDate()).padStart(2, "0");
      setDate(`${yyyy}-${mm}-${dd}`);
    }
  };

  const currentPickerDate = useMemo(() => {
    if (!date) return new Date();
    const parts = date.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }, [date]);

  const onCommitSave = async () => {
    if (!parentName.trim()) {
      setErr("Parent label identifier required.");
      return;
    }
    if (childItems.length === 0) {
      setErr("Add at least one child expense item down below.");
      return;
    }

    setSaving(true);
    setErr(null);

    const consolidatedNotes = childItems.map((c, i) => `[Item ${i + 1}: ${c.note || "No details"}]`).join(" ");

    try {
      if (isEditing && targetExpense) {
        await expensesApi.update(targetExpense.id, {
          expense_date: date,
          parent_name: parentName.trim(),
          amount: totals.total,
          source: parentSourceDetermined,
          personal_amount: totals.personal,
          business_amount: totals.business,
          note: consolidatedNotes,
          items: childItems
        });
      } else {
        await expensesApi.create({
          expense_date: date,
          parent_name: parentName.trim(),
          amount: totals.total,
          source: parentSourceDetermined,
          personal_amount: totals.personal,
          business_amount: totals.business,
          note: consolidatedNotes,
          items: childItems
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Failed transactional sync");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalWrap}>
        <View style={[styles.sheet, { maxHeight: "95%" }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{isEditing ? "Modify Batch Entry" : "New Custom Batch"}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={styles.label}>Parent Reference Title</Text>
            <TextInput value={parentName} onChangeText={setParentName} placeholder="e.g. Weekly Raw Materials, Shop Renovations" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />

            <Text style={styles.label}>Log Event Date</Text>
            <View style={styles.dateRow}>
              <Pressable 
                onPress={() => setShowDatePicker(true)} 
                style={[styles.input, { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }]}
              >
                <Text style={{ color: theme.color.onSurface, fontSize: 15 }}>
                  {formatDisplayDate(date) || "Select a date..."}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={theme.color.brandPrimary} />
              </Pressable>
              <Pressable onPress={() => setDate(todayISO())} style={styles.todayBtn}>
                <Text style={{ color: theme.color.brandPrimary, fontWeight: "700" }}>Today</Text>
              </Pressable>
            </View>

            {showDatePicker && (
              <View style={Platform.OS === "ios" ? styles.iosPickerContainer : null}>
                <DateTimePicker
                  value={currentPickerDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  onChange={onDateChange}
                  maximumDate={new Date()}
                />
                {Platform.OS === "ios" && (
                  <Pressable 
                    style={styles.iosConfirmBtn}
                    onPress={() => setShowDatePicker(false)}
                  >
                    <Text style={styles.iosConfirmBtnText}>Confirm Date Selection</Text>
                  </Pressable>
                )}
              </View>
            )}

            <Text style={[styles.label, { marginTop: 20 }]}>Staged Structural Elements ({childItems.length})</Text>
            {childItems.map((item, idx) => (
              <View key={idx} style={{ flexDirection: "row", padding: 10, backgroundColor: theme.color.surfaceSecondary, marginBottom: 6, borderRadius: 6, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>{formatINRPlain(item.amount)} <Text style={{ fontSize: 10, color: theme.color.brandPrimary }}>({item.source.toUpperCase()})</Text></Text>
                  {item.note && <Text style={{ fontSize: 12, color: theme.color.onSurfaceSecondary }}>{item.note}</Text>}
                </View>
                <Pressable onPress={() => handleRemoveChild(idx)}><Ionicons name="trash-outline" size={18} color={theme.color.error} /></Pressable>
              </View>
            ))}

            <View style={{ marginVertical: 14, padding: 12, backgroundColor: theme.color.brandTertiary, borderRadius: 8, borderWidth: 1, borderColor: theme.color.brandPrimary }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.color.brandPrimary }}>RUNNING BATCH SUMMATION TOTAL</Text>
              <Text style={{ fontSize: 24, fontWeight: "800", color: theme.color.brandPrimary, marginVertical: 2 }}>{formatINRPlain(totals.total)}</Text>
              <Text style={{ fontSize: 11, color: theme.color.onSurfaceSecondary }}>Split: Personal: {formatINRPlain(totals.personal)} | Business: {formatINRPlain(totals.business)}</Text>
            </View>

            <View style={{ padding: 12, borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, marginTop: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: "800", color: theme.color.onSurfaceSecondary, marginBottom: 8 }}>+ APPEND CHILD ITEM LINE</Text>
              
              <TextInput value={cAmount} onChangeText={setCAmount} keyboardType="decimal-pad" placeholder="Amount (₹)" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { marginBottom: 8 }]} />
              <TextInput value={cNote} onChangeText={setCNote} placeholder="Item Details (e.g., Gold chains, cord set bags)" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { marginBottom: 8 }]} />

              <View style={[styles.segRow, { marginBottom: 8 }]}>
                {(["personal", "business", "both"] as Source[]).map((s) => (
                  <Pressable key={s} onPress={() => setCSource(s)} style={[styles.seg, { borderColor: s === cSource ? theme.color.brandPrimary : theme.color.border }, s === cSource && { backgroundColor: theme.color.brandTertiary }]}>
                    <Text style={{ color: s === cSource ? theme.color.brandPrimary : theme.color.onSurfaceSecondary, fontWeight: "700", fontSize: 11 }}>{s.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>

              {cSource === "both" && (
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TextInput value={cPersonalAmt} onChangeText={setCPersonalAmt} keyboardType="decimal-pad" placeholder="Pers. ₹" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
                  <TextInput value={cBusinessAmt} onChangeText={setCBusinessAmt} keyboardType="decimal-pad" placeholder="Bus. ₹" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
                </View>
              )}

              <Pressable onPress={handleAddChild} style={{ backgroundColor: theme.color.surfaceTertiary, padding: 10, borderRadius: 6, alignItems: "center" }}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700", fontSize: 13 }}>Stage Line Item</Text>
              </Pressable>
            </View>

            {err && <Text style={styles.errText}>{err}</Text>}

            <Pressable onPress={onCommitSave} disabled={childItems.length === 0 || saving} style={[styles.saveBtn, childItems.length === 0 && { opacity: 0.5 }, { marginTop: 20 }]}>
              {saving ? <ActivityIndicator color={theme.color.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save Full Batch Log</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------------- Structural Custom Detail Viewer Modal ---------------- */
function ExpenseDetailModal({
  item,
  onClose,
  onEditRequested,
}: {
  item: Expense;
  onClose: () => void;
  onEditRequested: (target: Expense) => void;
}) {
  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={[styles.sheet, { maxHeight: "85%" }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Batch Transaction Log</Text>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <Pressable onPress={() => onEditRequested(item)} style={{ padding: 6 }}><Ionicons name="create-outline" size={22} color={theme.color.brandPrimary} /></Pressable>
              <Pressable onPress={onClose} style={styles.closeBtn}><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
            <View style={styles.detailAmountBlock}>
              <Text style={{ fontSize: 13, color: theme.color.onSurfaceTertiary, fontWeight: "700" }}>{item.parent_name}</Text>
              <Text style={styles.detailAmount}>{formatINRPlain(item.total_amount || item.amount)}</Text>
              <SourcePill source={item.source} />
            </View>

            <DetailRow label="Formatted Date" value={formatDisplayDate(item.expense_date)} />
            <DetailRow label="Personal Allocation" value={formatINRPlain(item.personal_amount)} />
            <DetailRow label="Business Allocation" value={formatINRPlain(item.business_amount)} />

            <Text style={[styles.label, { marginTop: 15 }]}>Line Items Summary Breakdown</Text>
            {item.items && item.items.length > 0 ? (
              item.items.map((c, i) => (
                <View key={c.id || i} style={{ padding: 10, backgroundColor: theme.color.surfaceSecondary, borderRadius: 6, marginTop: 6, borderWidth: 1, borderColor: theme.color.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>{formatINRPlain(c.amount)}</Text>
                    <Text style={{ fontSize: 10, color: theme.color.onSurfaceTertiary, fontWeight: "700" }}>{c.source.toUpperCase()}</Text>
                  </View>
                  {c.note && <Text style={{ fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 }}>{c.note}</Text>}
                </View>
              ))
            ) : (
              <Text style={{ fontStyle: "italic", color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 4 }}>No atomic child metadata fragments present</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function SummaryCard({ label, fund, spent, balance, color, icon }: { label: string; fund: number; spent: number; balance: number; color: string; icon: any }) {
  const low = balance <= fund * 0.15;
  return (
    <View style={styles.sumCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={styles.sumLabel}>{label}</Text>
      </View>
      <Text style={[styles.sumBalance, low && { color: theme.color.error }]}>{formatINRPlain(balance)}</Text>
      <View style={styles.sumMetaRow}>
        <Text style={styles.sumMeta}>Fund {formatINRPlain(fund)}</Text>
        <Text style={styles.sumMeta}>Spent {formatINRPlain(spent)}</Text>
      </View>
    </View>
  );
}

// Fixed missing type safety check for unused Image import cleanups
function SourcePill({ source }: { source: Source }) {
  const color = source === "personal" ? theme.color.brandPrimary : source === "business" ? theme.color.success : theme.color.warning;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{source.toUpperCase()}</Text>
    </View>
  );
}

function SetFundModal({ visible, current, onClose, onSaved }: { visible: boolean; current: number; onClose: () => void; onSaved: () => void }) {
  const [val, setVal] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setVal(String(current)); setErr(null); } }, [visible, current]);

  const onSave = async () => {
    setSaving(true); setErr(null);
    try { await expensesApi.setPersonalFund(Number(val) || 0); onSaved(); } catch (e: any) { setErr(e.message || "Failed saving"); } finally { setSaving(false); }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmBox, { width: "88%" }]}>
          <Text style={styles.confirmTitle}>Personal Fund Allocation</Text>
          <TextInput value={val} onChangeText={setVal} keyboardType="decimal-pad" style={[styles.input, { marginTop: 12 }]} />
          {err && <Text style={styles.errText}>{err}</Text>}
          <View style={styles.confirmRow}>
            <Pressable onPress={onClose} style={[styles.confirmBtn, { backgroundColor: theme.color.surfaceTertiary }]}><Text style={styles.confirmBtnText}>Cancel</Text></Pressable>
            <Pressable onPress={onSave} disabled={saving} style={[styles.confirmBtn, { backgroundColor: theme.color.brandPrimary }]}>
              {saving ? <ActivityIndicator color={theme.color.onBrandPrimary} /> : <Text style={[styles.confirmBtnText, { color: theme.color.onBrandPrimary }]}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Styles ---------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    alignItems: "center",
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  title: { color: theme.color.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: 0.5 },
  subtitle: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  scroll: { padding: theme.spacing.lg, paddingBottom: 120 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  summaryRow: { flexDirection: "row", gap: theme.spacing.md },
  sumCard: {
    flex: 1,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  sumLabel: { color: theme.color.onSurfaceTertiary, fontSize: 11, fontWeight: "600" },
  sumBalance: {
    color: theme.color.onSurface, fontSize: 20, fontWeight: "800",
    marginTop: 10,
  },
  sumMetaRow: { marginTop: 8, gap: 2 },
  sumMeta: { color: theme.color.onSurfaceTertiary, fontSize: 11 },

  totalCard: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandPrimary,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { color: theme.color.onBrandTertiary, fontSize: 12, letterSpacing: 1 },
  totalValue: { color: theme.color.brandPrimary, fontSize: 26, fontWeight: "800", marginTop: 4 },
  totalMeta: { alignItems: "flex-end", gap: 4 },
  totalMetaText: { color: theme.color.onBrandTertiary, fontSize: 11 },

  listHeader: {
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  listCount: { color: theme.color.onSurfaceTertiary, fontSize: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  rowAmount: { color: theme.color.onSurface, fontSize: 16, fontWeight: "800" },
  rowMeta: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  pill: {
    borderWidth: 1, borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },

  emptyBox: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: theme.color.onSurfaceSecondary, marginTop: 8, fontSize: 15, fontWeight: "600" },

  errText: { color: theme.color.error, fontSize: 12, marginTop: 8 },

  fab: {
    position: "absolute",
    right: theme.spacing.lg,
    bottom: 80,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 8,
    borderTopWidth: 1, borderColor: theme.color.border,
  },
  sheetHandle: {
    width: 44, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong,
    alignSelf: "center", marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sheetTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.surfaceSecondary,
  },
  label: {
    color: theme.color.onSurfaceTertiary, fontSize: 11, fontWeight: "600",
    letterSpacing: 1, textTransform: "uppercase",
    marginTop: 12, marginBottom: 6,
  },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border, borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: 12,
    color: theme.color.onSurface, fontSize: 15,
  },
  segRow: { flexDirection: "row", gap: 8 },
  seg: {
    flex: 1,
    height: 42,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  dateRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  todayBtn: {
    flexDirection: "row",
    alignSelf: "center",
    gap: 4,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.brandPrimary,
  },

  saveBtn: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.color.brandPrimary,
    borderRadius: theme.radius.md,
    paddingVertical: 16, alignItems: "center",
  },
  saveBtnText: { color: theme.color.onBrandPrimary, fontSize: 16, fontWeight: "700" },

  confirmOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
    padding: theme.spacing.lg,
  },
  confirmBox: {
    width: "100%",
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderColor: theme.color.border, borderWidth: 1,
    padding: theme.spacing.xl,
  },
  confirmTitle: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: theme.spacing.lg },
  confirmBtn: {
    flex: 1, height: 46, borderRadius: theme.radius.md,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnText: { color: theme.color.onSurface, fontWeight: "700" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginTop: 6,
  },
  searchInput: { flex: 1, paddingVertical: 12, color: theme.color.onSurface, fontSize: 15 },
  chipRow: { gap: 8, alignItems: "center", paddingRight: theme.spacing.md },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  detailAmountBlock: {
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 16,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  detailAmount: {
    color: theme.color.brandPrimary,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  detailLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  detailValue: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },

  iosPickerContainer: {
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  iosConfirmBtn: {
    backgroundColor: theme.color.surfaceTertiary,
    padding: 12,
    borderRadius: 6,
    marginTop: theme.spacing.md,
  },
  iosConfirmBtnText: {
    textAlign: "center",
    fontWeight: "700",
    color: theme.color.onSurface,
    fontSize: 14,
  },
});
