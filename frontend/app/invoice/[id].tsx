import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { api, Bill, ExchangeHistoryEntry } from "@/src/api/client";
import { theme, formatINRPlain } from "@/src/theme";

// The receipt is meant to look like a physical paper receipt — always
// white with black ink — regardless of whether the surrounding app is
// running a light or dark theme.
const RECEIPT_PAPER = "#FFFFFF";
const RECEIPT_INK = "#000000";

const escHtml = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function buildBillHtml(bill: Bill, exchangeHistory: ExchangeHistoryEntry[]) {
  const discountPct =
    bill.gross_amount > 0 && bill.discount > 0
      ? Math.round((bill.discount / bill.gross_amount) * 100)
      : null;
  const discountLabel =
    discountPct != null && discountPct > 0 ? `Discount (${discountPct}%)` : "Discount";
  const itemRows = bill.items
    .map(
      (i) => `
        <tr>
          <td class="td name">${escHtml(i.item_name)}</td>
          <td class="td qty">${i.qty}</td>
          <td class="td price">${formatINRPlain(i.price)}</td>
          <td class="td total"><b>${formatINRPlain(i.line_total)}</b></td>
        </tr>
      `
    )
    .join("");

  const exchangeBlock = exchangeHistory.length
    ? `
      <div class="dash"></div>
      <div class="section-title">Exchange Record</div>
      ${exchangeHistory
        .map(
          (ex) => `
        <div class="ex-row">
          <div class="ex-date">${escHtml(
            new Date(ex.exchanged_at).toLocaleString("en-IN")
          )}</div>
          <div class="ex-line">Returned: ${escHtml(ex.old_item_name)} (x${
            ex.old_qty
          }) — ${formatINRPlain(ex.old_line_total)}</div>
          <div class="ex-line">Given: ${escHtml(ex.new_item_name)} (x${
            ex.new_qty
          }) — ${formatINRPlain(ex.new_line_total)}</div>
          <div class="ex-diff">${
            ex.price_diff >= 0
              ? `Customer paid ${formatINRPlain(ex.price_diff)}`
              : `Refunded ${formatINRPlain(-ex.price_diff)}`
          }</div>
        </div>
      `
        )
        .join("")}
    `
    : "";

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escHtml(bill.bill_number)}</title>
      <style>
        @page { size: 80mm auto; margin: 6mm; }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
          margin: 0; padding: 0;
          color: ${RECEIPT_INK};
          background: ${RECEIPT_PAPER};
          font-size: 12px;
        }
        .paper {
          max-width: 360px;
          margin: 0 auto;
          padding: 18px 18px 24px;
        }
        .store { font-size: 22px; font-weight: 900; letter-spacing: 4px; text-align: center; }
        .tag { font-size: 11px; color: #666; text-align: center; margin-top: 4px; letter-spacing: 1.5px; font-style: italic; }
        .dash { border-top: 1px dashed #999; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; margin-top: 4px; }
        .row .k { color: #444; font-weight: 500; }
        .row .v { color: ${RECEIPT_INK}; font-weight: 600; }
        .row.big .k { font-size: 15px; font-weight: 700; }
        .row.big .v { font-size: 18px; font-weight: 800; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; }
        .th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #333; padding: 4px 2px; border-bottom: 1px solid #ddd; }
        .td { padding: 4px 2px; font-size: 12px; }
        .td.qty, .td.price, .td.total { text-align: right; }
        .td.name { width: 45%; }
        .paid-stamp { display: none; }
        .thanks {
          text-align: center;
          margin-top: 20px;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 1px;
          color: ${RECEIPT_INK};
        }
        .section-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
          color: #333; margin-bottom: 6px;
        }
        .ex-row { padding: 6px 0; border-bottom: 1px solid #eee; }
        .ex-date { color: #888; font-size: 10px; font-weight: 700; }
        .ex-line { font-size: 11px; margin-top: 2px; }
        .ex-diff { color: #9B111E; font-size: 11px; font-weight: 700; margin-top: 3px; }
      </style>
    </head>
    <body>
      <div class="paper">
        <div class="store">IMINATIONZ</div>
        <div class="tag">Wear Elegance. Share Kindness.</div>
        <div class="dash"></div>
        <div class="row"><span class="k">Bill No</span><span class="v">${escHtml(bill.bill_number)}</span></div>
        <div class="row"><span class="k">Date</span><span class="v">${escHtml(bill.date)}</span></div>
        <div class="row"><span class="k">Day</span><span class="v">${escHtml(bill.day)}</span></div>
        <div class="row"><span class="k">Time</span><span class="v">${escHtml(bill.time)}</span></div>
        ${bill.customer_name ? `<div class="row"><span class="k">Name</span><span class="v">${escHtml(bill.customer_name)}</span></div>` : ""}
        ${bill.customer_mobile ? `<div class="row"><span class="k">Mobile</span><span class="v">${escHtml(bill.customer_mobile)}</span></div>` : ""}
        <div class="dash"></div>

        <table>
          <thead>
            <tr>
              <th class="th">Item</th>
              <th class="th" style="text-align:right;">Qty</th>
              <th class="th" style="text-align:right;">Rate</th>
              <th class="th" style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        ${exchangeBlock}

        <div class="dash"></div>
        <div class="row"><span class="k">Gross</span><span class="v">${formatINRPlain(bill.gross_amount)}</span></div>
        ${
          bill.discount > 0
            ? `<div class="row"><span class="k">${discountLabel}</span><span class="v">-${formatINRPlain(bill.discount)}</span></div>`
            : ""
        }
        <div class="row big"><span class="k">Final</span><span class="v">${formatINRPlain(bill.final_amount)}</span></div>
        <div class="dash"></div>
        <div class="row"><span class="k">Cash</span><span class="v">${formatINRPlain(bill.cash_amount)}</span></div>
        <div class="row"><span class="k">UPI</span><span class="v">${formatINRPlain(bill.upi_amount)}</span></div>

        <div class="thanks">Thank you for supporting us</div>
      </div>
    </body>
  </html>
  `;
}

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeHistoryEntry[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const b = await api.getBill(id);
        setBill(b);
        if ((b.exchange_count || 0) > 0) {
          try {
            const hist = await api.getExchangeHistory(id);
            setExchangeHistory(hist);
          } catch {
            // Non-fatal
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const discountPct =
    bill && bill.gross_amount > 0 && bill.discount > 0
      ? Math.round((bill.discount / bill.gross_amount) * 100)
      : null;

  const onSharePdf = async () => {
    if (!bill || sharing) return;
    setShareError(null);
    setSharing(true);
    try {
      const html = buildBillHtml(bill, exchangeHistory);

      if (Platform.OS === "web") {
        // Web: open a printable window with only the bill; browser's
        // print dialog lets user "Save as PDF" or send to any printer.
        // Popup blockers may require the user to click again the first time.
        const w = window.open("", "_blank", "width=420,height=800");
        if (!w) {
          setShareError("Please allow pop-ups for this site to share the bill.");
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        // Give the doc a tick to lay out, then trigger print.
        setTimeout(() => {
          try {
            w.focus();
            w.print();
          } catch {
            /* noop */
          }
        }, 400);
        return;
      }

      // Native: render to PDF, then rename so the share sheet shows a
      // human-readable filename (WhatsApp/Mail rely on the file name).
      const printed = await Print.printToFileAsync({ html, base64: false });
      const targetUri =
        (FileSystem as any).cacheDirectory + `Invoice_${bill.bill_number}.pdf`;
      try {
        // moveAsync may fail if the target already exists — delete first.
        try {
          await (FileSystem as any).deleteAsync(targetUri, { idempotent: true });
        } catch {
          /* noop */
        }
        await (FileSystem as any).moveAsync({ from: printed.uri, to: targetUri });
      } catch {
        // Fall back to sharing the auto-generated path directly.
      }
      const finalUri =
        (await (FileSystem as any)
          .getInfoAsync?.(targetUri)
          .then((i: any) => (i?.exists ? targetUri : printed.uri))
          .catch(() => printed.uri)) || printed.uri;

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        setShareError(
          "Sharing isn't available on this device. Try again from a build with sharing enabled."
        );
        return;
      }
      await Sharing.shareAsync(finalUri, {
        mimeType: "application/pdf",
        dialogTitle: `Invoice ${bill.bill_number}`,
        UTI: "com.adobe.pdf",
      });
    } catch (e: any) {
      // Surface the real error to the UI so the user can report it.
      setShareError(e?.message || String(e) || "Failed to share invoice");
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Invoice</Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 32 }} />
      ) : error ? (
        <Text style={styles.errText}>{error}</Text>
      ) : bill ? (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
          <View style={styles.receipt} testID="invoice-receipt">
            <Text style={styles.store}>IMINATIONZ</Text>
            <Text style={styles.tag}>Wear Elegance. Share Kindness.</Text>
            <View style={styles.dash} />
            <Row k="Bill No" v={bill.bill_number} />
            <Row k="Date" v={`${bill.date}`} />
            <Row k="Day" v={bill.day} />
            <Row k="Time" v={bill.time} />
            {bill.customer_name ? <Row k="Name" v={bill.customer_name} /> : null}
            {bill.customer_mobile ? <Row k="Mobile" v={bill.customer_mobile} /> : null}
            <View style={styles.dash} />

            <View style={styles.thead}>
              <Text style={[styles.th, { flex: 2 }]}>Item</Text>
              <Text style={[styles.th, { width: 36, textAlign: "right" }]}>Qty</Text>
              <Text style={[styles.th, { width: 60, textAlign: "right" }]}>Rate</Text>
              <Text style={[styles.th, { width: 70, textAlign: "right" }]}>Total</Text>
            </View>

            {bill.items.map((it, idx) => (
              <View key={idx} style={styles.tr} testID={`invoice-line-${idx}`}>
                <Text style={[styles.td, { flex: 2 }]}>{it.item_name}</Text>
                <Text style={[styles.td, { width: 36, textAlign: "right" }]}>{it.qty}</Text>
                <Text style={[styles.td, { width: 60, textAlign: "right" }]}>
                  {formatINRPlain(it.price)}
                </Text>
                <Text style={[styles.td, { width: 70, textAlign: "right", fontWeight: "700" }]}>
                  {formatINRPlain(it.line_total)}
                </Text>
              </View>
            ))}

            {exchangeHistory.length > 0 && (
              <>
                <View style={styles.dash} />
                <Text style={styles.exchangeHistTitle}>Exchange Record</Text>
                {exchangeHistory.map((ex) => (
                  <View key={ex.id} style={styles.exchangeHistRow} testID={`invoice-exchange-${ex.id}`}>
                    <Text style={styles.exchangeHistDate}>
                      {new Date(ex.exchanged_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      {" · "}
                      {new Date(ex.exchanged_at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    <Text style={styles.exchangeHistLine}>
                      Returned: {ex.old_item_name} (x{ex.old_qty}) — {formatINRPlain(ex.old_line_total)}
                    </Text>
                    <Text style={styles.exchangeHistLine}>
                      Given: {ex.new_item_name} (x{ex.new_qty}) — {formatINRPlain(ex.new_line_total)}
                    </Text>
                    <Text style={styles.exchangeHistDiff}>
                      {ex.price_diff >= 0
                        ? `Customer paid ${formatINRPlain(ex.price_diff)}`
                        : `Refunded ${formatINRPlain(-ex.price_diff)}`}
                    </Text>
                  </View>
                ))}
              </>
            )}

            <View style={styles.dash} />

            <Row k="Gross" v={formatINRPlain(bill.gross_amount)} />
            {bill.discount > 0 && (
              <Row
                k={discountPct != null ? `Discount (${discountPct}%)` : "Discount"}
                v={`-${formatINRPlain(bill.discount)}`}
              />
            )}
            <Row k="Final" v={formatINRPlain(bill.final_amount)} bold big />
            <View style={styles.dash} />
            <Row k="Cash" v={formatINRPlain(bill.cash_amount)} />
            <Row k="UPI" v={formatINRPlain(bill.upi_amount)} />

            <Text style={styles.thanks} testID="thankyou-text">
              Thank you for supporting us
            </Text>
          </View>

          {shareError && (
            <Text testID="share-error" style={styles.shareError}>
              {shareError}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              testID="share-button"
              onPress={onSharePdf}
              disabled={sharing}
              style={[styles.btn, styles.primaryBtn, sharing && { opacity: 0.6 }]}
            >
              {sharing ? (
                <ActivityIndicator color={theme.color.onBrandPrimary} />
              ) : (
                <>
                  <Ionicons name="share-social" size={18} color={theme.color.onBrandPrimary} />
                  <Text style={[styles.btnText, { color: theme.color.onBrandPrimary }]}>
                    Share Bill as PDF
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ k, v, bold, big }: { k: string; v: string; bold?: boolean; big?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
      <Text style={{ color: "#444", fontSize: big ? 15 : 12, fontWeight: bold ? "700" : "500" }}>{k}</Text>
      <Text style={{ color: RECEIPT_INK, fontSize: big ? 18 : 12, fontWeight: bold ? "800" : "600" }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomColor: theme.color.divider,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.color.onSurface, fontSize: 18, fontWeight: "700" },
  errText: { color: theme.color.error, textAlign: "center", marginTop: 24 },
  receipt: {
    backgroundColor: RECEIPT_PAPER,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  store: { fontSize: 24, fontWeight: "900", color: RECEIPT_INK, textAlign: "center", letterSpacing: 3 },
  tag: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
    letterSpacing: 1.5,
    fontStyle: "italic",
  },
  dash: { borderTopWidth: 1, borderTopColor: "#bbb", borderStyle: "dashed", marginVertical: 8 },
  exchangeHistTitle: {
    color: "#333",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  exchangeHistRow: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  exchangeHistDate: { color: "#888", fontSize: 10, fontWeight: "700", marginBottom: 3 },
  exchangeHistLine: { color: RECEIPT_INK, fontSize: 11, marginTop: 1 },
  exchangeHistDiff: { color: "#9B111E", fontSize: 11, fontWeight: "700", marginTop: 3 },
  thead: { flexDirection: "row", marginTop: 4 },
  th: { color: "#333", fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", paddingVertical: 4 },
  td: { color: RECEIPT_INK, fontSize: 12 },
  thanks: {
    textAlign: "center",
    color: RECEIPT_INK,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 18,
  },
  shareError: {
    color: theme.color.error,
    textAlign: "center",
    marginTop: theme.spacing.md,
    fontSize: 13,
  },
  actions: { flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.xl },
  btn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: theme.radius.md,
  },
  primaryBtn: { backgroundColor: theme.color.brandPrimary },
  btnText: { fontWeight: "700", fontSize: 14 },
});
