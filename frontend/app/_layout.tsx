import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { RoleProvider } from "@/src/hooks/use-role";
import { DayOpenGate } from "@/app/components/DayOpenGate";
import { hydrateInventoryFromDisk } from "@/src/api/cache";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

// Fire once at module load — loads any on-device inventory snapshot into
// memory so the first screen that calls peekInventory() (billing, etc.)
// can paint instantly on a cold launch, instead of waiting on the network.
// Deliberately not awaited: this should never delay showing the app.
hydrateInventoryFromDisk();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RoleProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0D0D0D" } }} />
          <DayOpenGate />
        </RoleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
