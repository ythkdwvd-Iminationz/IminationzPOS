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
import {
  getSession,
  fetchMyRole,
  requestLoginOtp,
  verifyLoginOtp,
} from "@/src/api/client";
import { theme } from "@/src/theme";

type Step = "email" | "otp";

export default function LoginScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (s) {
        const role = await fetchMyRole();
        router.replace(
          role === "employee" ? "/(tabs)/billing" : "/(tabs)/dashboard"
        );
      } else {
        setChecking(false);
      }
    })();
  }, [router]);

  const startCooldown = () => {
    setResendCooldown(30);
    const interval = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes("@")) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await requestLoginOtp(clean);
      setStep("otp");
      startCooldown();
    } catch (e: any) {
      setError(e.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    if (otp.trim().length < 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await verifyLoginOtp(email.trim().toLowerCase(), otp.trim());
      const role = await fetchMyRole();
      router.replace(
        role === "employee" ? "/(tabs)/billing" : "/(tabs)/dashboard"
      );
    } catch (e: any) {
      setError(e.message || "Invalid or expired code");
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
            <Text style={styles.brandSub}>Jewellery POS · Supabase</Text>
          </View>

          <View style={styles.form}>
            {step === "email" ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  testID="login-username-input"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="you@iminationz.app"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={styles.input}
                  editable={!loading}
                />

                {error && (
                  <Text testID="login-error" style={styles.error}>
                    {error}
                  </Text>
                )}

                <Pressable
                  testID="login-submit-button"
                  onPress={sendOtp}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.button,
                    { opacity: pressed || loading ? 0.85 : 1 },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <Text style={styles.buttonText}>Send Code</Text>
                  )}
                </Pressable>

                <Text style={styles.hint}>
                  Enter your registered email to receive a login code
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.otpSentText}>
                  Code sent to{" "}
                  <Text style={{ fontWeight: "700", color: theme.color.onSurface }}>
                    {email}
                  </Text>
                </Text>

                <Text style={[styles.label, { marginTop: theme.spacing.lg }]}>
                  6-Digit Code
                </Text>
                <TextInput
                  testID="login-otp-input"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={[styles.input, styles.otpInput]}
                  editable={!loading}
                  autoFocus
                />

                {error && (
                  <Text testID="login-error" style={styles.error}>
                    {error}
                  </Text>
                )}

                <Pressable
                  testID="login-submit-button"
                  onPress={onVerify}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.button,
                    { opacity: pressed || loading ? 0.85 : 1 },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={theme.color.onBrandPrimary} />
                  ) : (
                    <Text style={styles.buttonText}>Verify & Sign In</Text>
                  )}
                </Pressable>

                <View style={styles.footerRow}>
                  <Pressable
                    testID="login-change-email"
                    onPress={() => {
                      setStep("email");
                      setOtp("");
                      setError(null);
                    }}
                    disabled={loading}
                  >
                    <Text style={styles.linkText}>Change email</Text>
                  </Pressable>

                  <Pressable
                    testID="login-resend-otp"
                    onPress={sendOtp}
                    disabled={loading || resendCooldown > 0}
                  >
                    <Text
                      style={[
                        styles.linkText,
                        resendCooldown > 0 && { color: theme.color.onSurfaceTertiary },
                      ]}
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
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
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: theme.color.brandTertiary,
    alignItems: "center", justifyContent: "center",
    marginBottom: theme.spacing.lg,
    borderWidth: 1, borderColor: theme.color.brandPrimary,
  },
  brandName: { fontSize: 30, color: theme.color.onSurface, fontWeight: "700", letterSpacing: 1 },
  brandSub: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  form: { gap: 4 },
  label: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: theme.color.surfaceSecondary,
    borderColor: theme.color.border, borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: 14,
    color: theme.color.onSurface, fontSize: 16,
  },
  otpInput: {
    textAlign: "center",
    fontSize: 22,
    letterSpacing: 8,
    fontWeight: "700",
  },
  otpSentText: {
    color: theme.color.onSurfaceSecondary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    backgroundColor: theme.color.brandPrimary,
    borderRadius: theme.radius.md,
    paddingVertical: 16, alignItems: "center",
    marginTop: theme.spacing.xl,
  },
  buttonText: { color: theme.color.onBrandPrimary, fontWeight: "700", fontSize: 16, letterSpacing: 0.5 },
  error: { color: theme.color.error, marginTop: theme.spacing.md, fontSize: 13 },
  hint: { color: theme.color.onSurfaceTertiary, fontSize: 12, textAlign: "center", marginTop: theme.spacing.lg },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: theme.spacing.lg,
  },
  linkText: { color: theme.color.brandPrimary, fontSize: 13, fontWeight: "600" },
});
