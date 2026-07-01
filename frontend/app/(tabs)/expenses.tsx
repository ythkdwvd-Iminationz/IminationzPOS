import { useCallback, useMemo, useState } from "react";
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
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { expensesApi, Expense, ExpenseOverview } from "@/src/api/client";
import { DateRangeModal } from "./sales";
import { theme, formatINRPlain } from "@/src/theme";

type Source = "personal" | "business" | "both";
type DateFilter = "all" | "today" | "month" | "custom";

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const monthStartISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

// Normalize any date-ish value (plain "YYYY-MM-DD", ISO timestamp, Date object)
// down to a clean "YYYY-MM-DD" string so comparisons are always apples-to-apples,
// regardless of what shape Supabase/PostgREST returns the `date` column in.
const normalizeDate = (val: string | null | undefined): string => {
  if (!val) return "";
  // Already clean "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // Has a "T" (timestamp) - just take the date part before it
  const tIndex = val.indexOf("T");
  if (tIndex > 0) return val.slice(0, tIndex);
  // Has a space separator (some drivers return "YYYY-MM-DD HH:MM:SS")
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

  const [addOpen, setAddOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);

  // filters
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

  // Filter + search
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
        const note = (e.note || "").toLowerCase();
        const amt = String(e.amount);
        return note.includes(q) || amt.includes(q);
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
            {overview
              ? `${overview.entries} entries · ${formatINRPlain(
                  overview.total_expenses
                )} spent`
              : "Track personal & business spends"}
          </Text>
        </View>
        <Pressable
          testID="expenses-set-fund-btn"
          onPress={() => setFundOpen(true)}
          style={styles.iconBtn}
        >
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
          {error && (
            <SetupNeededCard error={error} onRetry={load} />
          )}

          {overview && (
            <>
              <View style={styles.summaryRow}>
                <SummaryCard
                  testID="expense-card-personal"
                  label="Personal Balance"
                  fund={overview.personal_fund_total}
                  spent={overview.personal_spent}
                  balance={overview.personal_balance}
                  color={theme.color.brandPrimary}
                  icon="person-circle-outline"
                />
                <SummaryCard
                  testID="expense-card-business"
                  label="Business Balance"
                  fund={overview.business_fund_total}
                  spent={overview.business_spent}
                  balance={overview.business_balance}
                  color={theme.color.success}
                  icon="briefcase-outline"
                />
              </View>

              <View style={styles.totalCard} testID="expense-card-total">
                <View>
                  <Text style={styles.totalLabel}>Total Expenses</Text>
                  <Text style={styles.totalValue}>
                    {formatINRPlain(overview.total_expenses)}
                  </Text>
                </View>
                <View style={styles.totalMeta}>
                  <Text style={styles.totalMetaText}>
                    Personal {formatINRPlain(overview.personal_spent)}
                  </Text>
                  <Text style={styles.totalMetaText}>
                    Business {formatINRPlain(overview.business_spent)}
                  </Text>
                </View>
              </View>
            </>
          )}

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Recent</Text>
            <Text style={styles.listCount}>{filteredItems.length}</Text>
          </View>

          {/* Search */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
            <TextInput
              testID="expenses-search"
              value={search}
              onChangeText={setSearch}
              placeholder="Search by note or amount"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.searchInput}
            />
            {search.length > 0 && (
              <Pressable
                testID="expenses-search-clear"
                onPress={() => setSearch("")}
                style={styles.searchClear}
              >
                <Ionicons name="close" size={14} color={theme.color.onSurfaceSecondary} />
              </Pressable>
            )}
          </View>

          {/* Date filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            style={styles.chipRowWrap}
          >
            {FILTERS.map((f) => {
              const active = f.id === filter;
              return (
                <Pressable
                  key={f.id}
                  testID={`expenses-filter-${f.id}`}
                  onPress={() => {
                    setFilter(f.id);
                    if (f.id === "custom") setPickerOpen(true);
                  }}
                  style={[
                    styles.chip,
                    {
                      borderColor: active
                        ? theme.color.brandPrimary
                        : theme.color.border,
                      backgroundColor: active
                        ? theme.color.brandTertiary
                        : theme.color.surfaceSecondary,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active
                        ? theme.color.brandPrimary
                        : theme.color.onSurfaceSecondary,
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {filter === "custom" && (
            <Pressable
              testID="expenses-range-chip"
              onPress={() => setPickerOpen(true)}
              style={styles.rangeChip}
            >
              <Ionicons name="calendar" size={13} color={theme.color.brandPrimary} />
              <Text style={styles.rangeChipText}>
                {rangeStart} → {rangeEnd}
              </Text>
              <Ionicons name="create-outline" size={13} color={theme.color.brandPrimary} />
            </Pressable>
          )}

          {filteredItems.length === 0 ? (
            <View style={styles.emptyBox} testID="expenses-empty">
              <Ionicons
                name="wallet-outline"
                size={42}
                color={theme.color.onSurfaceTertiary}
              />
              <Text style={styles.emptyText}>
                {items.length === 0 ? "No expenses yet" : "No matches"}
              </Text>
              <Text style={styles.emptyHint}>
                {items.length === 0
                  ? "Tap the + button to add your first entry"
                  : "Try clearing the search or date filter"}
              </Text>
            </View>
          ) : (
            filteredItems.map((it) => (
              <ExpenseRow
                key={it.id}
                item={it}
                onOpen={() => setDetail(it)}
                onDelete={async () => {
                  await expensesApi.remove(it.id);
                  load();
                }}
              />
            ))
          )}
        </ScrollView>
      )}

      <Pressable
        testID="expenses-add-fab"
        onPress={() => setAddOpen(true)}
        style={styles.fab}
      >
        <Ionicons name="add" size={28} color={theme.color.onBrandPrimary} />
      </Pressable>

      <AddExpenseModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          load();
        }}
      />

      <SetFundModal
        visible={fundOpen}
        current={overview?.personal_fund_total ?? 200000}
        onClose={() => setFundOpen(false)}
        onSaved={() => {
          setFundOpen(false);
          load();
        }}
      />

      <DateRangeModal
        visible={pickerOpen}
        start={rangeStart}
        end={rangeEnd}
        onCancel={() => setPickerOpen(false)}
        onApply={(s, e) => {
          setRangeStart(s);
          setRangeEnd(e);
          setPickerOpen(false);
        }}
      />

      <ExpenseDetailModal
        item={detail}
        onClose={() => setDetail(null)}
        onDelete={async (id) => {
          await expensesApi.remove(id);
          setDetail(null);
          load();
        }}
      />
    </SafeAreaView>
  );
}

/* ---------------- Detail Modal ---------------- */

function ExpenseDetailModal({
  item,
  onClose,
  onDelete,
}: {
  item: Expense | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!item) return null;

  return (
    <Modal
      visible={!!item}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalWrap}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Expense Details</Text>
            <Pressable testID="expense-detail-close" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Amount block */}
            <View style={styles.detailAmountBlock}>
              <Text style={styles.detailAmount}>{formatINRPlain(item.amount)}</Text>
              <SourcePill source={item.source} />
            </View>

            {/* Fields grid */}
            <DetailRow label="Date" value={item.expense_date} testID="detail-date" />
            {item.source === "both" && (
              <>
                <DetailRow
                  label="Personal"
                  value={formatINRPlain(item.personal_amount)}
                  testID="detail-personal"
                />
                <DetailRow
                  label="Business"
                  value={formatINRPlain(item.business_amount)}
                  testID="detail-business"
                />
              </>
            )}
            <DetailRow
              label="Created"
              value={new Date(item.created_at).toLocaleString()}
              testID="detail-created"
            />

            {item.note ? (
              <View style={styles.detailNoteBox} testID="detail-note">
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailNote}>{item.note}</Text>
              </View>
            ) : null}

            {item.receipt_base64 ? (
              <>
                <Text style={[styles.detailLabel, { marginTop: 16 }]}>Receipt</Text>
                <Pressable
                  testID="detail-receipt"
                  onPress={() => setReceiptOpen(true)}
                >
                  <Image
                    source={{
                      uri: `data:${item.receipt_mime || "image/jpeg"};base64,${item.receipt_base64}`,
                    }}
                    style={styles.detailReceipt}
                  />
                  <Text style={styles.detailReceiptHint}>Tap to view full size</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.detailNoReceipt}>
                <Ionicons name="image-outline" size={16} color={theme.color.onSurfaceTertiary} />
                <Text style={styles.detailNoReceiptText}>No receipt attached</Text>
              </View>
            )}

            <Pressable
              testID="detail-delete-btn"
              onPress={() => setConfirm(true)}
              style={styles.detailDelBtn}
            >
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={styles.detailDelText}>Delete Expense</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>

      <Modal
        transparent
        visible={receiptOpen}
        animationType="fade"
        onRequestClose={() => setReceiptOpen(false)}
      >
        <Pressable style={styles.receiptOverlay} onPress={() => setReceiptOpen(false)}>
          <Image
            source={{
              uri: `data:${item.receipt_mime || "image/jpeg"};base64,${item.receipt_base64}`,
            }}
            style={styles.receiptFull}
            resizeMode="contain"
          />
        </Pressable>
      </Modal>

      <Modal transparent visible={confirm} animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Delete this expense?</Text>
            <Text style={styles.confirmBody}>
              This will restore {formatINRPlain(item.amount)} to your balances.
            </Text>
            <View style={styles.confirmRow}>
              <Pressable
                onPress={() => setConfirm(false)}
                style={[styles.confirmBtn, { backgroundColor: theme.color.surfaceTertiary }]}
              >
                <Text style={styles.confirmBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="detail-delete-confirm"
                onPress={() => {
                  setConfirm(false);
                  onDelete(item.id);
                }}
                style={[styles.confirmBtn, { backgroundColor: theme.color.error }]}
              >
                <Text style={[styles.confirmBtnText, { color: "#fff" }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View style={styles.detailRow} testID={testID}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

/* ---------------- Summary Card ---------------- */

function SummaryCard({
  label,
  fund,
  spent,
  balance,
  color,
  icon,
  testID,
}: {
  label: string;
  fund: number;
  spent: number;
  balance: number;
  color: string;
  icon: any;
  testID?: string;
}) {
  const low = balance <= fund * 0.15;
  return (
    <View testID={testID} style={styles.sumCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={styles.sumLabel}>{label}</Text>
      </View>
      <Text style={[styles.sumBalance, low && { color: theme.color.error }]}>
        {formatINRPlain(balance)}
      </Text>
      <View style={styles.sumMetaRow}>
        <Text style={styles.sumMeta}>Fund {formatINRPlain(fund)}</Text>
        <Text style={styles.sumMeta}>Spent {formatINRPlain(spent)}</Text>
      </View>
    </View>
  );
}

/* ---------------- Expense Row ---------------- */

function ExpenseRow({
  item,
  onDelete,
  onOpen,
}: {
  item: Expense;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Pressable
        testID={`expense-row-${item.id}`}
        onPress={onOpen}
        style={styles.row}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.rowAmount}>{formatINRPlain(item.amount)}</Text>
            <SourcePill source={item.source} />
          </View>
          <Text style={styles.rowMeta}>
            {item.expense_date}
            {item.source === "both"
              ? ` · P ${formatINRPlain(item.personal_amount)} · B ${formatINRPlain(
                  item.business_amount
                )}`
              : ""}
          </Text>
          {item.note ? (
            <Text style={styles.rowNote} numberOfLines={2}>
              {item.note}
            </Text>
          ) : null}
        </View>
        {item.receipt_base64 ? (
          <View style={styles.thumb} testID={`expense-receipt-${item.id}`}>
            <Image
              source={{
                uri: `data:${item.receipt_mime || "image/jpeg"};base64,${item.receipt_base64}`,
              }}
              style={{ width: 46, height: 46, borderRadius: 6 }}
            />
          </View>
        ) : null}
        <Pressable
          testID={`expense-delete-${item.id}`}
          onPress={(e) => {
            e.stopPropagation();
            setConfirm(true);
          }}
          style={styles.delBtn}
        >
          <Ionicons name="trash-outline" size={16} color={theme.color.error} />
        </Pressable>
      </Pressable>

      <Modal transparent visible={confirm} animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Delete this expense?</Text>
            <Text style={styles.confirmBody}>
              This will restore {formatINRPlain(item.amount)} to your balances.
            </Text>
            <View style={styles.confirmRow}>
              <Pressable
                onPress={() => setConfirm(false)}
                style={[styles.confirmBtn, { backgroundColor: theme.color.surfaceTertiary }]}
              >
                <Text style={styles.confirmBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID={`expense-delete-confirm-${item.id}`}
                onPress={() => {
                  setConfirm(false);
                  onDelete();
                }}
                style={[styles.confirmBtn, { backgroundColor: theme.color.error }]}
              >
                <Text style={[styles.confirmBtnText, { color: "#fff" }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ---------------- Setup card ---------------- */

const MIGRATION_SQL = `-- Run once in Supabase SQL Editor
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value_num numeric,
  value_text text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.app_settings(key, value_num)
VALUES ('personal_fund_total', 200000)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount >= 0),
  source text NOT NULL CHECK (source IN ('personal','business','both')),
  personal_amount numeric NOT NULL DEFAULT 0 CHECK (personal_amount >= 0),
  business_amount numeric NOT NULL DEFAULT 0 CHECK (business_amount >= 0),
  note text,
  receipt_base64 text,
  receipt_mime text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses authed all" ON public.expenses;
CREATE POLICY "expenses authed all" ON public.expenses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "settings authed all" ON public.app_settings;
CREATE POLICY "settings authed all" ON public.app_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- Force PostgREST to notice the new tables
NOTIFY pgrst, 'reload schema';`;

function SetupNeededCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  const missingTable =
    error.toLowerCase().includes("could not find the table") ||
    error.toLowerCase().includes("schema cache") ||
    error.toLowerCase().includes("does not exist");

  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diag, setDiag] = useState<{ table: string; ok: boolean; message: string }[] | null>(
    null
  );
  const [diagLoading, setDiagLoading] = useState(false);

  const onCopy = async () => {
    await Clipboard.setStringAsync(MIGRATION_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const onDiagnose = async () => {
    setDiagLoading(true);
    try {
      const res = await expensesApi.diagnose();
      setDiag(res);
    } catch {
      setDiag(null);
    } finally {
      setDiagLoading(false);
    }
  };

  if (!missingTable) {
    return (
      <View testID="expenses-error" style={styles.errBox}>
        <Ionicons name="alert-circle" size={16} color={theme.color.error} />
        <Text style={styles.errText}>{error}</Text>
      </View>
    );
  }

  return (
    <View testID="expenses-setup-needed" style={styles.setupCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="construct" size={18} color={theme.color.warning} />
        <Text style={styles.setupTitle}>One-time setup needed</Text>
      </View>
      <Text style={styles.setupBody}>
        Supabase says it can&apos;t find the <Text style={{ fontWeight: "700" }}>expenses</Text> and{" "}
        <Text style={{ fontWeight: "700" }}>app_settings</Text> tables. Do this once:
      </Text>

      <View style={styles.stepList}>
        <SetupStep n={1} text="Tap 'Copy SQL' below" />
        <SetupStep n={2} text="Open Supabase → your project → SQL Editor → New query → Paste → Run" />
        <SetupStep n={3} text="Check the bottom of SQL Editor: it must say 'Success. No rows returned' (no red error)" />
        <SetupStep n={4} text="Come back and tap Retry" />
      </View>

      <View style={styles.setupNote}>
        <Ionicons name="information-circle-outline" size={14} color={theme.color.brandPrimary} />
        <Text style={styles.setupNoteText}>
          Ran it but still failing? PostgREST cache is stale. Run just this in
          SQL Editor and tap Retry:
        </Text>
      </View>
      <View style={styles.notifyBox}>
        <Text style={styles.notifyText} selectable>
          NOTIFY pgrst, &apos;reload schema&apos;;
        </Text>
      </View>

      <View style={styles.setupBtnRow}>
        <Pressable
          testID="expenses-setup-copy"
          onPress={onCopy}
          style={[styles.setupBtn, { backgroundColor: theme.color.brandPrimary }]}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={14}
            color={theme.color.onBrandPrimary}
          />
          <Text style={[styles.setupBtnText, { color: theme.color.onBrandPrimary }]}>
            {copied ? "Copied!" : "Copy SQL"}
          </Text>
        </Pressable>
        <Pressable
          testID="expenses-setup-retry"
          onPress={onRetry}
          style={[styles.setupBtn, { backgroundColor: theme.color.surfaceTertiary }]}
        >
          <Ionicons name="refresh" size={14} color={theme.color.onSurface} />
          <Text style={[styles.setupBtnText, { color: theme.color.onSurface }]}>Retry</Text>
        </Pressable>
        <Pressable
          testID="expenses-setup-toggle-sql"
          onPress={() => setShowSql((s) => !s)}
          style={[styles.setupBtn, { borderColor: theme.color.brandPrimary, borderWidth: 1 }]}
        >
          <Ionicons
            name={showSql ? "chevron-up" : "chevron-down"}
            size={14}
            color={theme.color.brandPrimary}
          />
          <Text style={[styles.setupBtnText, { color: theme.color.brandPrimary }]}>
            {showSql ? "Hide SQL" : "View SQL"}
          </Text>
        </Pressable>
        <Pressable
          testID="expenses-setup-diagnose"
          onPress={onDiagnose}
          style={[styles.setupBtn, { borderColor: theme.color.warning, borderWidth: 1 }]}
        >
          {diagLoading ? (
            <ActivityIndicator size="small" color={theme.color.warning} />
          ) : (
            <Ionicons name="pulse" size={14} color={theme.color.warning} />
          )}
          <Text style={[styles.setupBtnText, { color: theme.color.warning }]}>Diagnose</Text>
        </Pressable>
      </View>

      {diag && (
        <View testID="expenses-setup-diagnose-result" style={styles.diagBox}>
          <Text style={styles.diagTitle}>Supabase reachability</Text>
          {diag.map((d) => (
            <View key={d.table} style={styles.diagRow}>
              <Ionicons
                name={d.ok ? "checkmark-circle" : "close-circle"}
                size={14}
                color={d.ok ? theme.color.success : theme.color.error}
              />
              <Text style={styles.diagTable}>{d.table}</Text>
              <Text style={styles.diagMsg} numberOfLines={1}>
                {d.message}
              </Text>
            </View>
          ))}
          <Text style={styles.diagFooter}>
            {diag.every((d) => d.ok)
              ? "All tables reachable — you can dismiss this card by tapping Retry."
              : diag.some((d) => d.table === "bills" && d.ok) &&
                diag.some(
                  (d) => (d.table === "expenses" || d.table === "app_settings") && !d.ok
                )
              ? "Your Supabase is connected but the new tables aren't there. The migration didn't run — check SQL Editor for a red error message and re-run it."
              : "Supabase itself is unreachable — check your internet."}
          </Text>
        </View>
      )}

      {showSql && (
        <ScrollView
          horizontal
          style={styles.sqlBox}
          testID="expenses-setup-sql"
        >
          <Text style={styles.sqlText} selectable>
            {MIGRATION_SQL}
          </Text>
        </ScrollView>
      )}

      <Text style={styles.setupHint}>
        Raw error: <Text style={{ color: theme.color.onSurfaceTertiary }}>{error}</Text>
      </Text>
    </View>
  );
}

function SetupStep({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function SourcePill({ source }: { source: Source }) {
  const color =
    source === "personal"
      ? theme.color.brandPrimary
      : source === "business"
      ? theme.color.success
      : theme.color.warning;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{source.toUpperCase()}</Text>
    </View>
  );
}

/* ---------------- Add Modal ---------------- */

function AddExpenseModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<Source>("business");
  const [personalAmt, setPersonalAmt] = useState("");
  const [businessAmt, setBusinessAmt] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [receiptB64, setReceiptB64] = useState<string | null>(null);
  const [receiptMime, setReceiptMime] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setAmount("");
    setSource("business");
    setPersonalAmt("");
    setBusinessAmt("");
    setDate(todayISO());
    setNote("");
    setReceiptB64(null);
    setReceiptMime(null);
    setErr(null);
  };

  const pickReceipt = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr("Permission denied for " + (fromCamera ? "camera" : "gallery"));
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({
          base64: true,
          quality: 0.6,
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
        });
    if (res.canceled) return;
    const asset = res.assets[0];
    setReceiptB64(asset.base64 || null);
    setReceiptMime(asset.mimeType || "image/jpeg");
  };

  const amt = Number(amount) || 0;
  const pAmt = source === "personal" ? amt : source === "both" ? Number(personalAmt) || 0 : 0;
  const bAmt = source === "business" ? amt : source === "both" ? Number(businessAmt) || 0 : 0;
  const bothMismatch = source === "both" && Math.abs(pAmt + bAmt - amt) > 0.01;

  const canSave = amt > 0 && !bothMismatch && !!date && !saving;

  const onSave = async () => {
    setErr(null);
    setSaving(true);
    try {
      await expensesApi.create({
        expense_date: date,
        amount: amt,
        source,
        personal_amount: pAmt,
        business_amount: bAmt,
        note: note.trim() || null,
        receipt_base64: receiptB64,
        receipt_mime: receiptMime,
      });
      reset();
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalWrap}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Add Expense</Text>
            <Pressable testID="expense-add-close" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              testID="expense-input-amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.input}
            />

            <Text style={styles.label}>Source</Text>
            <View style={styles.segRow}>
              {(["personal", "business", "both"] as Source[]).map((s) => {
                const active = s === source;
                return (
                  <Pressable
                    key={s}
                    testID={`expense-source-${s}`}
                    onPress={() => setSource(s)}
                    style={[
                      styles.seg,
                      { borderColor: active ? theme.color.brandPrimary : theme.color.border },
                      active && { backgroundColor: theme.color.brandTertiary },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? theme.color.brandPrimary : theme.color.onSurfaceSecondary,
                        fontWeight: "700",
                        fontSize: 13,
                      }}
                    >
                      {s === "personal" ? "Personal" : s === "business" ? "Business" : "Both"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {source === "both" && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Personal ₹</Text>
                  <TextInput
                    testID="expense-input-personal"
                    value={personalAmt}
                    onChangeText={setPersonalAmt}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceTertiary}
                    style={styles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Business ₹</Text>
                  <TextInput
                    testID="expense-input-business"
                    value={businessAmt}
                    onChangeText={setBusinessAmt}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.color.onSurfaceTertiary}
                    style={styles.input}
                  />
                </View>
              </View>
            )}
            {bothMismatch && (
              <Text style={styles.warnText}>
                Personal + Business ({formatINRPlain(pAmt + bAmt)}) must equal Amount ({formatINRPlain(amt)}).
              </Text>
            )}

            <Text style={styles.label}>Date</Text>
            <View style={styles.dateRow}>
              <DateAdjust
                label="-1d"
                onPress={() => setDate(shiftDate(date, -1))}
                testID="expense-date-minus"
              />
              <TextInput
                testID="expense-input-date"
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={[styles.input, { flex: 1, textAlign: "center" }]}
              />
              <DateAdjust
                label="+1d"
                onPress={() => setDate(shiftDate(date, 1))}
                testID="expense-date-plus"
              />
            </View>
            <Pressable
              testID="expense-date-today"
              onPress={() => setDate(todayISO())}
              style={styles.todayBtn}
            >
              <Ionicons name="calendar-outline" size={14} color={theme.color.brandPrimary} />
              <Text style={styles.todayBtnText}>Today</Text>
            </Pressable>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              testID="expense-input-note"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Gold polish material"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.input, { height: 80, textAlignVertical: "top" }]}
              multiline
            />

            <Text style={styles.label}>Receipt (optional)</Text>
            {receiptB64 ? (
              <View style={styles.receiptPreview}>
                <Image
                  source={{ uri: `data:${receiptMime || "image/jpeg"};base64,${receiptB64}` }}
                  style={styles.receiptImg}
                />
                <Pressable
                  testID="expense-receipt-remove"
                  onPress={() => {
                    setReceiptB64(null);
                    setReceiptMime(null);
                  }}
                  style={styles.receiptRemove}
                >
                  <Ionicons name="close-circle" size={22} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <View style={styles.receiptBtnRow}>
                <Pressable
                  testID="expense-receipt-camera"
                  onPress={() => pickReceipt(true)}
                  style={styles.receiptBtn}
                >
                  <Ionicons name="camera-outline" size={18} color={theme.color.brandPrimary} />
                  <Text style={styles.receiptBtnText}>Camera</Text>
                </Pressable>
                <Pressable
                  testID="expense-receipt-gallery"
                  onPress={() => pickReceipt(false)}
                  style={styles.receiptBtn}
                >
                  <Ionicons name="image-outline" size={18} color={theme.color.brandPrimary} />
                  <Text style={styles.receiptBtnText}>Gallery</Text>
                </Pressable>
              </View>
            )}

            {err && (
              <Text testID="expense-add-error" style={styles.errText}>
                {err}
              </Text>
            )}

            <Pressable
              testID="expense-add-save"
              onPress={onSave}
              disabled={!canSave}
              style={[styles.saveBtn, !canSave && { opacity: 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color={theme.color.onBrandPrimary} />
              ) : (
                <Text style={styles.saveBtnText}>Save Expense</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DateAdjust({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.dateAdjust}>
      <Text style={styles.dateAdjustText}>{label}</Text>
    </Pressable>
  );
}

function shiftDate(iso: string, delta: number) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return todayISO();
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ---------------- Set Fund Modal ---------------- */

function SetFundModal({
  visible,
  current,
  onClose,
  onSaved,
}: {
  visible: boolean;
  current: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [val, setVal] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useMemo(() => {
    if (visible) {
      setVal(String(current));
      setErr(null);
    }
  }, [visible, current]);

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await expensesApi.setPersonalFund(Number(val) || 0);
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmBox, { width: "88%" }]}>
          <Text style={styles.confirmTitle}>Personal Fund</Text>
          <Text style={styles.confirmBody}>
            Set the total personal money you have allocated for the business.
          </Text>
          <TextInput
            testID="fund-input"
            value={val}
            onChangeText={setVal}
            keyboardType="decimal-pad"
            style={[styles.input, { marginTop: 12 }]}
            placeholder="200000"
            placeholderTextColor={theme.color.onSurfaceTertiary}
          />
          {err && <Text style={styles.errText}>{err}</Text>}
          <View style={styles.confirmRow}>
            <Pressable
              onPress={onClose}
              style={[styles.confirmBtn, { backgroundColor: theme.color.surfaceTertiary }]}
            >
              <Text style={styles.confirmBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="fund-save"
              onPress={onSave}
              disabled={saving}
              style={[styles.confirmBtn, { backgroundColor: theme.color.brandPrimary }]}
            >
              {saving ? (
                <ActivityIndicator color={theme.color.onBrandPrimary} />
              ) : (
                <Text style={[styles.confirmBtnText, { color: theme.color.onBrandPrimary }]}>Save</Text>
              )}
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
  rowNote: { color: theme.color.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  pill: {
    borderWidth: 1, borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  thumb: {
    width: 46, height: 46, borderRadius: 6, overflow: "hidden",
    backgroundColor: theme.color.surfaceTertiary,
  },
  delBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.surfaceTertiary,
  },

  emptyBox: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: theme.color.onSurfaceSecondary, marginTop: 8, fontSize: 15, fontWeight: "600" },
  emptyHint: { color: theme.color.onSurfaceTertiary, fontSize: 12, marginTop: 4 },

  errBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#2d0e10",
    borderColor: theme.color.error, borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md, marginBottom: theme.spacing.md,
  },
  errText: { color: theme.color.error, fontSize: 12, marginTop: 8 },

  setupCard: {
    backgroundColor: "#1e1608",
    borderColor: theme.color.warning,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  setupTitle: {
    color: theme.color.warning,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  setupBody: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  stepList: { marginTop: 12, gap: 8 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepBadgeText: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: "700" },
  stepText: { color: theme.color.onSurface, fontSize: 13, flex: 1, lineHeight: 18 },
  sqlToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
  },
  sqlToggleText: { color: theme.color.brandPrimary, fontSize: 12, fontWeight: "700" },
  setupNote: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    alignItems: "flex-start",
  },
  setupNoteText: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },
  notifyBox: {
    marginTop: 6,
    backgroundColor: "#000",
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  notifyText: {
    color: "#a3e5a3",
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  setupBtnRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  setupBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  setupBtnText: { fontSize: 12, fontWeight: "700" },
  diagBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  diagTitle: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12, marginBottom: 6 },
  diagRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  diagTable: { color: theme.color.onSurface, fontSize: 12, fontWeight: "600", minWidth: 90 },
  diagMsg: { color: theme.color.onSurfaceTertiary, fontSize: 11, flex: 1 },
  diagFooter: { color: theme.color.onSurfaceSecondary, fontSize: 11, marginTop: 8, lineHeight: 15 },
  sqlBox: {
    marginTop: 8,
    maxHeight: 220,
    backgroundColor: "#000",
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    padding: 10,
  },
  sqlText: {
    color: "#a3e5a3",
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  setupHint: { marginTop: 10, color: theme.color.onSurfaceTertiary, fontSize: 11 },

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

  /* modal */
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "92%",
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
  dateAdjust: {
    height: 46, paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  dateAdjustText: { color: theme.color.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  todayBtn: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.brandPrimary,
  },
  todayBtnText: { color: theme.color.brandPrimary, fontSize: 11, fontWeight: "700" },
  warnText: { color: theme.color.warning, fontSize: 12, marginTop: 6 },

  receiptBtnRow: { flexDirection: "row", gap: 10 },
  receiptBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.brandPrimary, borderWidth: 1,
    borderRadius: theme.radius.md, paddingVertical: 12,
  },
  receiptBtnText: { color: theme.color.brandPrimary, fontSize: 13, fontWeight: "700" },
  receiptPreview: { position: "relative" },
  receiptImg: {
    width: "100%", height: 180, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
  },
  receiptRemove: {
    position: "absolute", top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },

  saveBtn: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.color.brandPrimary,
    borderRadius: theme.radius.md,
    paddingVertical: 16, alignItems: "center",
  },
  saveBtnText: { color: theme.color.onBrandPrimary, fontSize: 16, fontWeight: "700" },

  /* Confirm modal */
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
  confirmBody: { color: theme.color.onSurfaceTertiary, fontSize: 13, marginTop: 6 },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: theme.spacing.lg },
  confirmBtn: {
    flex: 1, height: 46, borderRadius: theme.radius.md,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnText: { color: theme.color.onSurface, fontWeight: "700" },

  receiptOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.9)",
    alignItems: "center", justifyContent: "center",
  },
  receiptFull: { width: "100%", height: "100%" },

  /* filters */
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
  searchClear: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.color.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  chipRowWrap: { marginTop: 10, marginBottom: 4 },
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
  rangeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
    backgroundColor: theme.color.brandTertiary,
  },
  rangeChipText: { color: theme.color.onBrandTertiary, fontSize: 12, fontWeight: "600" },

  /* detail modal */
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
  detailNoteBox: { marginTop: 12 },
  detailNote: {
    color: theme.color.onSurface,
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
    backgroundColor: theme.color.surfaceSecondary,
    padding: 12,
    borderRadius: theme.radius.md,
  },
  detailReceipt: {
    width: "100%",
    height: 260,
    borderRadius: theme.radius.md,
    marginTop: 6,
    backgroundColor: theme.color.surfaceSecondary,
  },
  detailReceiptHint: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 11,
    marginTop: 4,
    textAlign: "center",
  },
  detailNoReceipt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.md,
  },
  detailNoReceiptText: { color: theme.color.onSurfaceTertiary, fontSize: 12 },
  detailDelBtn: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.color.error,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
  },
  detailDelText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
