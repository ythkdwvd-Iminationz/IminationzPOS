import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import * as Linking from "expo-linking";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { whatsappApi, WhatsAppContact, normalizeIndianMobile } from "@/src/api/client";
import { useRole } from "@/src/hooks/use-role";

type StatusFilter = "all" | "pending" | "sent";

export default function WhatsAppContactsScreen() {
  const router = useRouter();
  const { role, loading: roleLoading } = useRole();
  const isOwner = role === "owner";

  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string>("");
  const [autoOpen, setAutoOpen] = useState<boolean>(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string>("");
  const [editingLink, setEditingLink] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      setError(null);
      const [settings, list] = await Promise.all([
        whatsappApi.getSettings(),
        whatsappApi.getContacts(),
      ]);
      setLink(settings.link);
      setLinkDraft(settings.link);
      setAutoOpen(settings.autoOpen);
      setContacts(list);
    } catch (e: any) {
      setError(e.message || "Failed to load contacts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filter === "sent" && !c.invite_sent_at) return false;
      if (filter === "pending" && c.invite_sent_at) return false;
      if (!q) return true;
      return (
        c.mobile.toLowerCase().includes(q) ||
        (c.last_name || "").toLowerCase().includes(q)
      );
    });
  }, [contacts, filter, search]);

  const counts = useMemo(() => {
    return contacts.reduce(
      (acc, c) => {
        acc.total += 1;
        if (c.invite_sent_at) acc.sent += 1;
        else acc.pending += 1;
        return acc;
      },
      { total: 0, sent: 0, pending: 0 }
    );
  }, [contacts]);

  const sendInvite = useCallback(
    async (c: WhatsAppContact) => {
      const url = whatsappApi.buildInviteUrl(c.mobile, c.last_name, link);
      if (!url) {
        Alert.alert("Invalid mobile", `Can't build a WhatsApp link for "${c.mobile}".`);
        return;
      }
      try {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          Alert.alert("WhatsApp not available", "Install WhatsApp to send invites.");
          return;
        }
        await Linking.openURL(url);
        // Optimistically mark as sent
        await whatsappApi.markSent(c.mobile).catch(() => {});
        setContacts((prev) =>
          prev.map((p) =>
            p.mobile === c.mobile
              ? { ...p, invite_sent_at: p.invite_sent_at || new Date().toISOString() }
              : p
          )
        );
      } catch (e: any) {
        Alert.alert("Couldn't open WhatsApp", e.message || "Unknown error");
      }
    },
    [link]
  );

  const saveLink = async () => {
    const trimmed = linkDraft.trim();
    if (!trimmed) {
      Alert.alert("Invite link required", "Paste your WhatsApp community invite link.");
      return;
    }
    if (!/^https?:\/\/chat\.whatsapp\.com\//i.test(trimmed)) {
      Alert.alert(
        "Not a community link",
        "It should start with https://chat.whatsapp.com/… — get it from WhatsApp → Community Info → Invite via link."
      );
      return;
    }
    setSavingSettings(true);
    try {
      await whatsappApi.updateSettings({ link: trimmed });
      setLink(trimmed);
      setEditingLink(false);
    } catch (e: any) {
      Alert.alert("Failed to save", e.message || "Unknown error");
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleAutoOpen = async () => {
    const next = !autoOpen;
    setAutoOpen(next); // optimistic
    setSavingSettings(true);
    try {
      await whatsappApi.updateSettings({ autoOpen: next });
    } catch (e: any) {
      setAutoOpen(!next); // revert
      Alert.alert("Failed to save", e.message || "Unknown error");
    } finally {
      setSavingSettings(false);
    }
  };

  if (roleLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.title}>WhatsApp Invites</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={36} color={theme.color.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Owner-only feature.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="wa-back" onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>WhatsApp Invites</Text>
          <Text style={styles.subtitle}>
            {counts.total} contacts · {counts.pending} pending · {counts.sent} sent
          </Text>
        </View>
        <Pressable
          testID="wa-refresh"
          onPress={() => {
            setRefreshing(true);
            load(true);
          }}
          hitSlop={8}
        >
          <Ionicons
            name="refresh"
            size={20}
            color={theme.color.onSurface}
            style={refreshing ? { opacity: 0.4 } : undefined}
          />
        </Pressable>
      </View>

      {/* Community link + auto-open toggle */}
      <View style={styles.settingsCard}>
        <View style={styles.settingsRow}>
          <Ionicons name="logo-whatsapp" size={16} color={theme.color.brandPrimary} />
          <Text style={styles.settingsLabel}>Community invite link</Text>
        </View>
        {editingLink ? (
          <>
            <TextInput
              testID="wa-link-input"
              value={linkDraft}
              onChangeText={setLinkDraft}
              placeholder="https://chat.whatsapp.com/…"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <View style={styles.settingsBtnRow}>
              <Pressable
                testID="wa-link-cancel"
                onPress={() => {
                  setLinkDraft(link);
                  setEditingLink(false);
                }}
                style={[styles.smallBtn, { backgroundColor: theme.color.surfaceTertiary }]}
              >
                <Text style={styles.smallBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="wa-link-save"
                onPress={saveLink}
                disabled={savingSettings}
                style={[
                  styles.smallBtn,
                  { backgroundColor: theme.color.brandPrimary },
                  savingSettings && { opacity: 0.5 },
                ]}
              >
                <Text style={[styles.smallBtnText, { color: theme.color.onBrandPrimary }]}>
                  Save
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.linkRow}>
            <Text testID="wa-link-value" style={styles.linkValue} numberOfLines={1}>
              {link || "(no link set)"}
            </Text>
            <Pressable
              testID="wa-link-edit"
              onPress={() => setEditingLink(true)}
              hitSlop={8}
              style={styles.editIconBtn}
            >
              <Ionicons name="create-outline" size={16} color={theme.color.brandPrimary} />
            </Pressable>
          </View>
        )}

        <Pressable
          testID="wa-auto-open-toggle"
          onPress={toggleAutoOpen}
          disabled={savingSettings}
          style={[styles.autoRow, savingSettings && { opacity: 0.6 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.autoLabel}>Auto-open on new bill</Text>
            <Text style={styles.autoHelp}>
              Opens WhatsApp with the invite pre-filled whenever a bill is completed with a new
              customer mobile.
            </Text>
          </View>
          <View style={[styles.toggle, autoOpen && styles.toggleOn]}>
            <View style={[styles.toggleKnob, autoOpen && styles.toggleKnobOn]} />
          </View>
        </Pressable>
      </View>

      {/* Search + filter */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
        <TextInput
          testID="wa-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or mobile"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          style={styles.searchInput}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.filterRow}>
        {(["all", "pending", "sent"] as StatusFilter[]).map((f) => {
          const active = f === filter;
          return (
            <Pressable
              key={f}
              testID={`wa-filter-${f}`}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text
                style={[styles.filterChipText, active && styles.filterChipTextActive]}
              >
                {f === "all"
                  ? `All (${counts.total})`
                  : f === "pending"
                    ? `Pending (${counts.pending})`
                    : `Sent (${counts.sent})`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.mobile}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="chatbubble-outline" size={36} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.emptyText}>
                {contacts.length === 0
                  ? "No customer mobiles yet — collect one on your next bill."
                  : "No contacts match this filter."}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const sent = !!item.invite_sent_at;
            const normalized = normalizeIndianMobile(item.mobile);
            const canSend = !!normalized;
            return (
              <View style={styles.row} testID={`wa-row-${item.mobile}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.last_name || "Unnamed customer"}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {item.mobile} · {item.bill_count} bill{item.bill_count !== 1 ? "s" : ""} ·
                    last {new Date(item.last_bill_iso).toLocaleDateString("en-IN")}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: sent ? theme.color.success : theme.color.warning,
                        },
                      ]}
                    >
                      <Text style={styles.badgeText}>{sent ? "Invited" : "Pending"}</Text>
                    </View>
                    {!canSend && (
                      <View style={[styles.badge, { backgroundColor: theme.color.error }]}>
                        <Text style={styles.badgeText}>Bad mobile</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Pressable
                  testID={`wa-send-${item.mobile}`}
                  onPress={() => sendInvite(item)}
                  disabled={!canSend}
                  style={[
                    styles.sendBtn,
                    !canSend && { opacity: 0.4 },
                    sent && { backgroundColor: theme.color.surfaceSecondary, borderColor: theme.color.border },
                  ]}
                >
                  <Ionicons
                    name="logo-whatsapp"
                    size={16}
                    color={sent ? theme.color.brandPrimary : theme.color.onBrandPrimary}
                  />
                  <Text
                    style={[
                      styles.sendBtnText,
                      sent && { color: theme.color.brandPrimary },
                    ]}
                  >
                    {sent ? "Resend" : "Send"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  title: { color: theme.color.onSurface, fontSize: 17, fontWeight: "700" },
  subtitle: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyText: { color: theme.color.onSurfaceTertiary, fontSize: 13, textAlign: "center" },
  error: {
    color: theme.color.error,
    fontSize: 12,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },
  settingsCard: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  settingsLabel: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  linkValue: {
    flex: 1,
    color: theme.color.onSurface,
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  editIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.brandTertiary,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: theme.color.onSurface,
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  settingsBtnRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  smallBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    alignItems: "center",
  },
  smallBtnText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 13 },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopColor: theme.color.divider,
    borderTopWidth: 1,
  },
  autoLabel: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
  autoHelp: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  toggle: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.color.surfaceTertiary,
    padding: 2,
    justifyContent: "center",
  },
  toggleOn: { backgroundColor: theme.color.brandPrimary },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.color.surface,
    alignSelf: "flex-start",
  },
  toggleKnobOn: { alignSelf: "flex-end" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 10, color: theme.color.onSurface, fontSize: 14 },
  filterRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderColor: theme.color.border,
    borderWidth: 1,
    backgroundColor: theme.color.surfaceSecondary,
  },
  filterChipActive: {
    borderColor: theme.color.brandPrimary,
    backgroundColor: theme.color.brandTertiary,
  },
  filterChipText: { color: theme.color.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  filterChipTextActive: { color: theme.color.brandPrimary },
  listContent: { padding: theme.spacing.lg },
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
  rowName: { color: theme.color.onSurface, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: theme.color.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
    backgroundColor: theme.color.brandPrimary,
  },
  sendBtnText: { color: theme.color.onBrandPrimary, fontSize: 12, fontWeight: "800" },
});
