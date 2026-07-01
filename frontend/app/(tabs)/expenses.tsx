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
import { expensesApi, Expense, ExpenseOverview } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

type Source = "personal" | "business" | "both";

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export default function ExpensesScreen() {
  const [overview, setOverview] = useState<ExpenseOverview | null>(null);
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);

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
            <Text style={styles.listCount}>{items.length}</Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyBox} testID="expenses-empty">
              <Ionicons
                name="wallet-outline"
                size={42}
                color={theme.color.onSurfaceTertiary}
              />
              <Text style={styles.emptyText}>No expenses yet</Text>
              <Text style={styles.emptyHint}>
                Tap the + button to add your first entry
              </Text>
            </View>
          ) : (
            items.map((it) => (
              <ExpenseRow
                key={it.id}
                item={it}
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
    </SafeAreaView>
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
}: {
  item: Expense;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  return (
    <>
      <View style={styles.row} testID={`expense-row-${item.id}`}>
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
          <Pressable
            testID={`expense-receipt-${item.id}`}
            onPress={() => setShowReceipt(true)}
            style={styles.thumb}
          >
            <Image
              source={{ uri: `data:${item.receipt_mime || "image/jpeg"};base64,${item.receipt_base64}` }}
              style={{ width: 46, height: 46, borderRadius: 6 }}
            />
          </Pressable>
        ) : null}
        <Pressable
          testID={`expense-delete-${item.id}`}
          onPress={() => setConfirm(true)}
          style={styles.delBtn}
        >
          <Ionicons name="trash-outline" size={16} color={theme.color.error} />
        </Pressable>
      </View>

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

      <Modal transparent visible={showReceipt} animationType="fade" onRequestClose={() => setShowReceipt(false)}>
        <Pressable style={styles.receiptOverlay} onPress={() => setShowReceipt(false)}>
          {item.receipt_base64 ? (
            <Image
              source={{ uri: `data:${item.receipt_mime || "image/jpeg"};base64,${item.receipt_base64}` }}
              style={styles.receiptFull}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
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
        The Expenses feature needs 2 tables in your Supabase project. Run the
        SQL below once in the Supabase SQL Editor, then tap Retry.
      </Text>

      <View style={styles.stepList}>
        <SetupStep n={1} text="Open Supabase → your project → SQL Editor → New query" />
        <SetupStep n={2} text="Paste the migration SQL and click Run" />
        <SetupStep n={3} text="Tap Retry below" />
      </View>

      <View style={styles.setupNote}>
        <Ionicons name="information-circle-outline" size={14} color={theme.color.brandPrimary} />
        <Text style={styles.setupNoteText}>
          Already ran the SQL and still seeing this? Supabase&apos;s PostgREST
          cache is stale. In SQL Editor run just this line and try again:
        </Text>
      </View>
      <View style={styles.notifyBox}>
        <Text style={styles.notifyText} selectable>
          NOTIFY pgrst, &apos;reload schema&apos;;
        </Text>
      </View>

      <View style={styles.setupBtnRow}>
        <Pressable
          testID="expenses-setup-retry"
          onPress={onRetry}
          style={[styles.setupBtn, { backgroundColor: theme.color.brandPrimary }]}
        >
          <Ionicons name="refresh" size={14} color={theme.color.onBrandPrimary} />
          <Text style={[styles.setupBtnText, { color: theme.color.onBrandPrimary }]}>
            Retry
          </Text>
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
            {showSql ? "Hide SQL" : "Show migration SQL"}
          </Text>
        </Pressable>
      </View>

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
});
