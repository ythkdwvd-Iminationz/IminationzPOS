export const theme = {
  color: {
    // ---- Surfaces: white/beige family (was near-black) ----
    surface: "#FFFFFF",              // main background — was #0D0D0D
    onSurface: "#2B2620",            // primary text on surface — was #FDFBF7 (near-black warm charcoal, not pure black, keeps it soft)
    surfaceSecondary: "#F5EFE3",     // beige — cards, inputs — was #1A1A1A
    onSurfaceSecondary: "#3D362C",   // text on beige — was #EAE6DF
    surfaceTertiary: "#EDE3D0",      // deeper beige — chips, qty boxes — was #262626
    onSurfaceTertiary: "#655B48",    // muted/tertiary text — was #C0BCB5 (darkened from an earlier #8A7F6B pass to clear 4.5:1 contrast for small hint/label text)
    surfaceInverse: "#2B2620",       // inverted surface (e.g. tooltips, status badges) — was #FDFBF7
    onSurfaceInverse: "#FFFFFF",     // text on inverse — was #0D0D0D

    // ---- Brand: kept warm gold/tan, unchanged in hue, same as before ----
    brand: "#C5A059",
    brandPrimary: "#96701F",         // deepened from #D4AF37 so white button text (Complete Bill, Add Item, etc.) hits 4.5:1 contrast on white; the original gold was tuned to sit on near-black, too pale on white at that lightness
    onBrandPrimary: "#FFFFFF",       // text on gold buttons — was #1A1500 (dark-on-gold); switched to white since the deepened gold is dark enough for white text now
    brandSecondary: "#AA8743",       // unchanged, already mid-tone
    brandTertiary: "#F3E6C8",        // light warm tan for highlight backgrounds/badges — was #3D3318 (a dark tan, now flipped light)
    onBrandTertiary: "#7A5B1E",      // text on the light tan badges — was #E8C87F (light-on-dark, now dark-on-light)

    // ---- Status colors: same hues, kept dark enough to stay legible on white ----
    success: "#2E8B57",              // unchanged — already reads fine on white
    onSuccess: "#F0FBF4",            // was #E0F4E8, kept as a near-white tint for text on solid success backgrounds
    warning: "#B9791F",              // deepened from #E6A23C — the original was tuned for a dark backdrop; needs to be darker to stay legible as text/icon color on white
    onWarning: "#FFFFFF",            // was #2B1D0B (dark-on-warning); now light text since warning is now a darker solid tone
    error: "#9B111E",                // unchanged — already dark enough for white backgrounds
    onError: "#FBECEE",              // unchanged
    info: "#5C6B73",                 // unchanged — a neutral slate, works on both

    // ---- Borders/dividers: light warm greys instead of near-black ----
    border: "#E3D9C6",                // was #2E2E2E
    borderStrong: "#C9BB9E",          // was #4A4A4A
    divider: "#EDE6D6",                // was #242424
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 16, pill: 999 },
  font: {
    display: "System",
    text: "System",
  },
};

// Modified: Strictly formats whole numbers without any fractional or decimal logic
export const formatINR = (n: number) => {
  const rounded = Math.round(Math.abs(n));
  return `₹${rounded.toLocaleString("en-IN")}${n < 0 ? " (return)" : ""}`;
};

export const formatINRPlain = (n: number) => {
  const rounded = Math.round(n);
  return `₹${rounded.toLocaleString("en-IN")}`;
};
