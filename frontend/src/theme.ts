export const theme = {
  color: {
    surface: "#0D0D0D",
    onSurface: "#FDFBF7",
    surfaceSecondary: "#1A1A1A",
    onSurfaceSecondary: "#EAE6DF",
    surfaceTertiary: "#262626",
    onSurfaceTertiary: "#C0BCB5",
    surfaceInverse: "#FDFBF7",
    onSurfaceInverse: "#0D0D0D",
    brand: "#C5A059",
    brandPrimary: "#D4AF37",
    onBrandPrimary: "#1A1500",
    brandSecondary: "#AA8743",
    brandTertiary: "#3D3318",
    onBrandTertiary: "#E8C87F",
    success: "#2E8B57",
    onSuccess: "#E0F4E8",
    warning: "#E6A23C",
    onWarning: "#2B1D0B",
    error: "#9B111E",
    onError: "#FBECEE",
    info: "#5C6B73",
    border: "#2E2E2E",
    borderStrong: "#4A4A4A",
    divider: "#242424",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 16, pill: 999 },
  font: {
    display: "System",
    text: "System",
  },
};

export const formatINR = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${n < 0 ? " (return)" : ""}`;

export const formatINRPlain = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
