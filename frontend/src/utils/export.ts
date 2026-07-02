import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { api, Bill, InventoryItem } from "@/src/api/client";

const todayStamp = () =>
  new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);

function bookFromSheets(sheets: { name: string; rows: any[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return wb;
}

async function downloadOrShare(filename: string, base64: string, mime: string) {
  if (Platform.OS === "web") {
    const a = document.createElement("a");
    a.href = `data:${mime};base64,${base64}`;
    a.download = filename;
    a.click();
    return;
  }
  // Native: write base64 to cache and use system share sheet
  const uri = (FileSystem as any).cacheDirectory + filename;
  await (FileSystem as any).writeAsStringAsync(uri, base64, {
    encoding: (FileSystem as any).EncodingType?.Base64 ?? "base64",
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: filename });
  }
}

function csvFromRows(rows: any[][]) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}

async function downloadCsv(filename: string, csv: string) {
  if (Platform.OS === "web") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const uri = (FileSystem as any).cacheDirectory + filename;
  await (FileSystem as any).writeAsStringAsync(uri, csv, {
    encoding: (FileSystem as any).EncodingType?.UTF8 ?? "utf8",
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: filename });
  }
}

function salesSheets(bills: Bill[]) {
  const salesHeader = [
    "Bill No", "Date", "Day", "Time", "Customer Name", "Mobile", "Items",
    "Gross", "Discount", "Final", "Cash", "UPI", "Status",
  ];
  const salesRows = [salesHeader, ...bills.map((b) => [
    b.bill_number, b.date, b.day, b.time, b.customer_name || "", b.customer_mobile || "",
    b.items.map((i) => `${i.item_name} x${i.qty}`).join("; "),
    b.gross_amount, b.discount, b.final_amount, b.cash_amount, b.upi_amount, b.payment_status,
  ])];

  const lineHeader = ["Bill No", "Date", "Item ID", "Item Name", "Qty", "Price", "Line Total"];
  const lineRows: any[][] = [lineHeader];
  bills.forEach((b) => {
    b.items.forEach((it) => {
      lineRows.push([b.bill_number, b.date, it.item_id, it.item_name, it.qty, it.price, it.line_total]);
    });
  });

  const totSales = bills.reduce((s, b) => s + b.final_amount, 0);
  const totCash = bills.reduce((s, b) => s + b.cash_amount, 0);
  const totUpi = bills.reduce((s, b) => s + b.upi_amount, 0);
  const totDisc = bills.reduce((s, b) => s + b.discount, 0);
  const itemsSold = bills.reduce((s, b) => s + b.items.reduce((a, i) => a + i.qty, 0), 0);
  const summary = [
    ["Metric", "Value"],
    ["Total Bills", bills.length],
    ["Total Sales", totSales],
    ["Cash", totCash],
    ["UPI", totUpi],
    ["Discount Given", totDisc],
    ["Items Sold", itemsSold],
  ];

  return { salesRows, lineRows, summary };
}

export async function exportSalesXlsx(
  filter: string = "month",
  start?: string,
  end?: string
) {
  const bills = await api.listBills({ filter, start_date: start, end_date: end });
  const { salesRows, lineRows, summary } = salesSheets(bills);
  const wb = bookFromSheets([
    { name: "Sales", rows: salesRows },
    { name: "Line Items", rows: lineRows },
    { name: "Summary", rows: summary },
  ]);
  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const tag = filter === "custom" && start && end ? `${start}_to_${end}` : filter;
  await downloadOrShare(
    `iminationz_sales_${tag}_${todayStamp()}.xlsx`,
    base64,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export async function exportSalesCsv(
  filter: string = "month",
  start?: string,
  end?: string
) {
  const bills = await api.listBills({ filter, start_date: start, end_date: end });
  const { salesRows } = salesSheets(bills);
  const tag = filter === "custom" && start && end ? `${start}_to_${end}` : filter;
  await downloadCsv(
    `iminationz_sales_${tag}_${todayStamp()}.csv`,
    csvFromRows(salesRows)
  );
}

function inventoryRows(items: InventoryItem[]) {
  const header = [
    "Item ID", "Category", "Name", "Price", "Cost Price",
    "Opening Qty", "Current Qty", "Sold Qty", "Low Stock",
  ];
  return [
    header,
    ...items.map((i) => [
      i.item_id, i.category, i.item_name, i.price, i.cost_price,
      i.opening_qty, i.current_qty, i.sold_qty, i.current_qty <= 5 ? "YES" : "",
    ]),
  ];
}

export async function exportInventoryXlsx() {
  const items = await api.listInventory();
  const wb = bookFromSheets([{ name: "Inventory", rows: inventoryRows(items) }]);
  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  await downloadOrShare(
    `iminationz_inventory_${todayStamp()}.xlsx`,
    base64,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export async function exportInventoryCsv() {
  const items = await api.listInventory();
  await downloadCsv(
    `iminationz_inventory_${todayStamp()}.csv`,
    csvFromRows(inventoryRows(items))
  );
}
