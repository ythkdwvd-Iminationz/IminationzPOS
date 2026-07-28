import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";
import { api } from "@/src/api/client";
import { supabase } from "@/src/api/supabase";

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Shown once per calendar day, the first time the app opens that day on
// *any* device — the answer is stored in Supabase (day_status table) so all
// devices see the same status for a given date, not just the one that
// answered. Asks whether the shop is open or closed today.
export function DayOpenGate() {
  const [visible, setVisible] = useState(false);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only prompt once a user is actually logged in — this table requires
      // an authenticated session per its RLS policy.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const today = todayISO();
      try {
        const existing = await api.getDayStatus(today);
        if (cancelled) return;
        if (existing === null) {
          setDateISO(today);
          setVisible(true);
        }
      } catch {
        // If the check fails (offline, table not migrated yet, etc.) skip
        // the popup rather than blocking the app.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const respond = async (status: "open" | "closed") => {
    if (!dateISO || saving) return;
    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await api.setDayStatus(dateISO, status, session?.user?.email ?? null);
      setVisible(false);
    } catch {
      // Leave the popup open so they can retry — better than silently
      // losing today's answer.
    } finally {
      setSaving(false);
    }
  };

  if (!dateISO) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Is the shop open today?</Text>
          <Text style={styles.sub}>This helps track how many days you were actually open this month.</Text>

          <View style={styles.actions}>
            <Pressable
              testID="day-status-closed"
              disabled={saving}
              onPress={() => respond("closed")}
              style={[styles.btn, styles.btnClosed]}
            >
              <Text style={styles.btnClosedText}>Closed today</Text>
            </Pressable>
            <Pressable
              testID="day-status-open"
              disabled={saving}
              onPress={() => respond("open")}
              style={[styles.btn, styles.btnOpen]}
            >
              <Text style={styles.btnOpenText}>Shop is open</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
  },
  title: {
    fontSize: 19,
    fontWeight: "800",
    color: theme.color.onSurface,
    textAlign: "center",
  },
  sub: {
    fontSize: 13,
    color: theme.color.onSurfaceTertiary,
    textAlign: "center",
    marginTop: theme.spacing.sm,
    lineHeight: 18,
  },
  actions: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  btn: {
    borderRadius: theme.radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnOpen: {
    backgroundColor: theme.color.brandPrimary,
  },
  btnOpenText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
  },
  btnClosed: {
    backgroundColor: theme.color.surfaceSecondary,
  },
  btnClosedText: {
    color: theme.color.onSurfaceSecondary,
    fontWeight: "700",
    fontSize: 15,
  },
});
