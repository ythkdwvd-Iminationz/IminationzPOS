import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, getToken, setToken } from "@/src/api/client";
import { theme } from "@/src/theme";

export default function LoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const tok = await getToken();
      if (tok) router.replace("/(tabs)/dashboard");
      else setChecking(false);
    })();
  }, [router]);

  const onLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(username.trim(), password);
      await setToken(res.token);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      setError(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <ActivityIndicator color={theme.color.brandPrimary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <View style={styles.logoCircle}>
              <Ionicons name="diamond" size={42} color={theme.color.brandPrimary} />
            </View>
            <Text style={styles.brandName}>Iminationz</Text>
            <Text style={styles.brandSub}>Jewellery POS System</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              testID="login-username-input"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              placeholder="admin"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.input}
            />

            <Text style={[styles.label, { marginTop: theme.spacing.lg }]}>Password</Text>
            <TextInput
              testID="login-password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.input}
            />

            {error && (
              <Text testID="login-error" style={styles.error}>
                {error}
              </Text>
            )}

            <Pressable
              testID="login-submit-button"
              onPress={onLogin}
              disabled={loading}
              style={({ pressed }) => [
                styles.button,
                { opacity: pressed || loading ? 0.85 : 1 },
              ]}
            >
              {loading ? (
                <ActivityIndicator color={theme.color.onBrandPrimary} />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </Pressable>

            <Text style={styles.hint}>Default: admin / admin123</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  content: { flex: 1, paddingHorizontal: theme.spacing.xl, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: theme.spacing.xxxl },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.color.brandPrimary,
  },
  brandName: {
    fontSize: 30,
    color: theme.color.onSurface,
    fontWeight: "700",
    letterSpacing: 1,
  },
  brandSub: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  form: { gap: 4 },
  label: {
    fontSize: 12,
    color: theme.color.onSurfaceTertiary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    color: theme.color.onSurface,
    fontSize: 16,
  },
  button: {
    backgroundColor: theme.color.brandPrimary,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: theme.spacing.xl,
  },
  buttonText: {
    color: theme.color.onBrandPrimary,
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.5,
  },
  error: {
    color: theme.color.error,
    marginTop: theme.spacing.md,
    fontSize: 13,
  },
  hint: {
    color: theme.color.onSurfaceTertiary,
    fontSize: 12,
    textAlign: "center",
    marginTop: theme.spacing.lg,
  },
});
