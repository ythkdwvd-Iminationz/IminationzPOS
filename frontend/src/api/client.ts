import { supabase } from "./supabase";

export const OWNER_WHATSAPP_NUMBERS = ["9044625875", "8188996721"];
export const STORE_NAME = "Iminationz";

// ---------- Types ----------
export interface InventoryItem {
  id: string;
  item_id: string;
  category: string;
  item_name: string;
  price: number; // Whole Number
  cost_price: number; // Whole Number
  opening_qty: number;
  current_qty: number;
  sold_qty: number;
  exchange_count: number; 
  created_date: string;
  last_updated: string;
}

export interface BillItem {
  id: string; 
  inv_id: string;
  item_id: string;
  item_name: string;
  price: number; // Whole Number
  qty: number;
  line_total: number; // Whole Number
  is_custom_price?: boolean; // Owner-set custom price override
}

export interface Bill {
  id: string;
  bill_number: string;
  customer_mobile: string | null;
  customer_name?: string | null;
  date: string;
  day: string;
  time: string;
  iso: string;
  items: BillItem[];
  gross_amount: number; // Whole Number
  discount: number; // Whole Number
  final_amount: number; // Whole Number
  cash_amount: number; // Whole Number
  upi_amount: number; // Whole Number
  payment_status: string;
  created_by_email?: string | null;
  created_by_role?: "owner" | "employee" | null;
  exchanged_at?: string | null;
  exchange_count?: number;
  last_exchanged_by_email?: string | null;
  last_exchanged_by_role?: "owner" | "employee" | null;
}

export interface ExchangeHistoryEntry {
  id: string;
  bill_id: string;
  bill_number: string;
  old_item_id: string;
  old_item_name: string;
  old_qty: number;
  old_line_total: number; // Whole Number
  new_item_id: string;
  new_item_name: string;
  new_qty: number;
  new_line_total: number; // Whole Number
  price_diff: number; // Whole Number
  cash_settled: number; // Whole Number
  upi_settled: number; // Whole Number
  exchanged_at: string; 
  exchanged_by_email: string | null;
  exchanged_by_role: "owner" | "employee" | null;
}

export interface DashboardData {
  date: string;
  total_sales: number; // Whole Number
  total_cash: number; // Whole Number
  total_upi: number; // Whole Number
  total_bills: number;
  items_sold: number;
  discount_given: number; // Whole Number
  average_bill_value: number; // Whole Number
  total_inventory_qty: number;
  low_stock_count: number;
  store_name: string;
}

export interface DailyReport {
  date: string;
  total_bills: number;
  total_sales: number; // Whole Number
  total_cash: number; // Whole Number
  total_upi: number; // Whole Number
  discount_given: number; // Whole Number
  items_sold: number;
  average_bill_value: number; // Whole Number
}

export interface InventoryReport {
  items: InventoryItem[];
  summary: { total_opening: number; total_current: number; total_sold: number; low_stock_count: number };
  low_stock: InventoryItem[];
}

export interface CustomerInfo {
  mobile: string;
  is_returning: boolean;
  visits: number;
  total_spent: number; // Whole Number
  last_visit: string | null;
  last_name: string | null;
}

export interface CategoryRow {
  category: string;
  qty_sold: number;
  revenue: number; // Whole Number
  cost: number; // Whole Number
  profit: number; // Whole Number
  margin_pct: number; // Whole Number
}

export interface WhatsAppClosing {
  date: string;
  message: string;
  owner_numbers: string[];
  links: { number: string; url: string }[];
}

export interface ExpenseItem {
  id?: string;
  expense_id?: string;
  amount: number; // Whole Number
  source: "personal" | "business" | "both";
  personal_amount: number; // Whole Number
  business_amount: number; // Whole Number
  note: string | null;
}

export interface Expense {
  id: string;
  expense_date: string; 
  parent_name: string;  
  total_amount: number; // Whole Number
  amount: number;        // Whole Number
  source: "personal" | "business" | "both";
  personal_amount: number; // Whole Number
  business_amount: number; // Whole Number
  note: string | null;   
  receipt_base64: string | null;
  receipt_mime: string | null;
  created_at: string;
  items?: ExpenseItem[]; 
}

export interface ExpenseOverview {
  personal_fund_total: number; // Whole Number
  business_fund_total: number; // Whole Number
  personal_spent: number; // Whole Number
  business_spent: number; // Whole Number
  personal_balance: number; // Whole Number
  business_balance: number; // Whole Number
  total_expenses: number; // Whole Number
  entries: number;
}


// ---------- helpers ----------
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const yesterdayIST = () =>
  new Date(Date.now() + IST_OFFSET_MS - 86400000).toISOString().slice(0, 10);
const monthStartIST = () => {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

function dateRangeForFilter(filter: string, start?: string, end?: string) {
  const t = todayIST();
  if (filter === "today") return { from: t, to: t };
  if (filter === "yesterday") return { from: yesterdayIST(), to: yesterdayIST() };
  if (filter === "month") return { from: monthStartIST(), to: t };
  if (filter === "custom" && start && end) return { from: start, to: end };
  return null;
}

// CHANGED: Now completely truncates/rounds to a whole number
function toWholeNumber(n: number) {
  return Math.round(n);
}

// ---------- Auth ----------
export type Role = "owner" | "employee";

export async function fetchMyRole(): Promise<Role> {
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email?.toLowerCase().trim();
  if (!email) return "owner";

  const probe = await supabase.from("user_roles").select("email,role").limit(50);
  if (probe.error) return "owner";

  const myRow = (probe.data || []).find(
    (r: any) => String(r.email).toLowerCase().trim() === email
  );
  if (!myRow) return "employee";
  return (myRow.role as Role) || "employee";
}

export async function login(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { store_name: STORE_NAME };
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ---------- OTP Auth ----------
export async function requestLoginOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false },
  });
  if (error) throw new Error(error.message);
  return { sent: true };
}

export async function verifyLoginOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw new Error(error.message);
  return { session: data.session, store_name: STORE_NAME };
}

// ---------- API surface ----------
export const api = {
  login: async (email: string, password: string) => login(email, password),

  // Inventory
  listInventory: async (): Promise<InventoryItem[]> => {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("category")
      .order("item_name");
    if (error) throw new Error(error.message);
    return (data || []).map(i => ({
      ...i,
      price: toWholeNumber(i.price),
      cost_price: toWholeNumber(i.cost_price)
    })) as InventoryItem[];
  },

  createInventory: async (body: Partial<InventoryItem>): Promise<InventoryItem> => {
    const payload = {
      item_id: (body.item_id || "").trim().toUpperCase(),
      category: body.category,
      item_name: body.item_name,
      price: toWholeNumber(body.price || 0),
      cost_price: toWholeNumber(body.cost_price || 0),
      opening_qty: body.opening_qty,
      current_qty: body.current_qty ?? body.opening_qty,
      sold_qty: 0,
    };
    const { data, error } = await supabase.from("inventory").insert(payload).select().single();
    if (error)
      throw new Error(error.code === "23505" ? "Item ID already exists" : error.message);
    return data as InventoryItem;
  },

  updateInventory: async (id: string, body: Partial<InventoryItem>): Promise<InventoryItem> => {
    const upd: any = { ...body, last_updated: new Date().toISOString() };
    delete upd.id;
    delete upd.item_id;
    if (upd.price !== undefined) upd.price = toWholeNumber(upd.price);
    if (upd.cost_price !== undefined) upd.cost_price = toWholeNumber(upd.cost_price);

    const { data, error } = await supabase
      .from("inventory")
      .update(upd)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as InventoryItem;
  },

  deleteInventory: async (id: string) => {
    const { error } = await supabase.from("inventory").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  },

  // Bills
  createBill: async (body: {
    customer_mobile?: string | null;
    customer_name?: string | null;
    cash_amount: number;
    upi_amount: number;
    items: { inv_id: string; qty: number; custom_price?: number | null }[];
  }): Promise<Bill> => {
    const { data, error } = await supabase.rpc("create_bill", {
      p_customer_mobile: body.customer_mobile || null,
      p_customer_name: body.customer_name || null,
      p_items: body.items.map((i) => ({
        inv_id: i.inv_id,
        qty: i.qty,
        custom_price: i.custom_price != null ? toWholeNumber(i.custom_price) : null,
      })),
      p_cash_amount: toWholeNumber(body.cash_amount),
      p_upi_amount: toWholeNumber(body.upi_amount),
    });
    if (error) throw new Error(error.message);
    const { data: full, error: e2 } = await supabase
      .from("v_bills_full")
      .select("*")
      .eq("id", (data as any).id)
      .single();
    if (e2) throw new Error(e2.message);
    return full as Bill;
  },

  listBills: async (params: {
    filter?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
  }): Promise<Bill[]> => {
    let q = supabase.from("v_bills_full").select("*").order("iso", { ascending: false });
    const range = dateRangeForFilter(params.filter || "today", params.start_date, params.end_date);
    if (range) q = q.gte("date", range.from).lte("date", range.to);
    if (params.search && params.search.trim()) {
      // Escape PostgREST .or() reserved chars ( , ) so a customer name with
      // spaces / punctuation doesn't blow up the request.
      const s = params.search.trim().replace(/[(),]/g, " ");
      q = q.or(
        `bill_number.ilike.%${s}%,customer_mobile.ilike.%${s}%,customer_name.ilike.%${s}%`
      );
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as Bill[];
  },

  getBill: async (id: string): Promise<Bill> => {
    const { data, error } = await supabase.from("v_bills_full").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data as Bill;
  },

  exchangeBillItem: async (body: {
    bill_id: string;
    old_bill_item_id: string;
    new_inv_id: string;
    new_qty: number;
    cash_amount: number;
    upi_amount: number;
  }): Promise<any> => {
    const { data, error } = await supabase.rpc("exchange_bill_item", {
      p_bill_id: body.bill_id,
      p_old_bill_item_id: body.old_bill_item_id,
      p_new_inv_id: body.new_inv_id,
      p_new_qty: body.new_qty,
      p_cash_amount: toWholeNumber(body.cash_amount),
      p_upi_amount: toWholeNumber(body.upi_amount),
    });
    if (error) throw new Error(error.message);
    return data as any;
  },

  getExchangeHistory: async (billId: string): Promise<ExchangeHistoryEntry[]> => {
    const { data, error } = await supabase
      .from("exchange_history")
      .select("*")
      .eq("bill_id", billId)
      .order("exchanged_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as ExchangeHistoryEntry[];
  },

  // Dashboard
  //
  // Owner asked to view "complete dashboard for a specific date". Optional
  // `date` (YYYY-MM-DD) — defaults to today (IST). All sales-related KPIs
  // (bills / cash / UPI / discount / avg bill / items sold) are scoped to
  // the requested date. Inventory KPIs (total qty, low stock) remain live —
  // we don't have historical stock snapshots, and viewing "current stock"
  // alongside any date is the desired behavior.
  dashboard: async (date?: string): Promise<DashboardData> => {
    const target = date || todayIST();
    const [{ data: bills }, { data: inv }] = await Promise.all([
      supabase.from("v_bills_full").select("*").eq("date", target),
      supabase.from("inventory").select("current_qty"),
    ]);
    const list = bills || [];
    const total_sales = toWholeNumber(sum(list, (b) => Number(b.final_amount)));
    const total_cash = toWholeNumber(sum(list, (b) => Number(b.cash_amount)));
    const total_upi = toWholeNumber(sum(list, (b) => Number(b.upi_amount)));
    const total_bills = list.length;
    const items_sold = list.reduce(
      (s, b) => s + ((b.items as any[]) || []).reduce((a, i) => a + Number(i.qty), 0),
      0
    );
    const discount_given = toWholeNumber(sum(list, (b) => Number(b.discount)));
    const total_inventory_qty = (inv || []).reduce((a, i) => a + Number(i.current_qty), 0);
    const low_stock_count = (inv || []).filter((i) => Number(i.current_qty) <= 5).length;
    return {
      date: target,
      total_sales,
      total_cash,
      total_upi,
      total_bills,
      items_sold,
      discount_given,
      average_bill_value: total_bills ? toWholeNumber(total_sales / total_bills) : 0,
      total_inventory_qty,
      low_stock_count,
      store_name: STORE_NAME,
    };
  },

  // Daily Report
  dailyReport: async (date?: string): Promise<DailyReport> => {
    const target = date || todayIST();
    const { data, error } = await supabase.from("v_bills_full").select("*").eq("date", target);
    if (error) throw new Error(error.message);
    const list = data || [];
    const total_sales = toWholeNumber(sum(list, (b) => Number(b.final_amount)));
    return {
      date: target,
      total_bills: list.length,
      total_sales,
      total_cash: toWholeNumber(sum(list, (b) => Number(b.cash_amount))),
      total_upi: toWholeNumber(sum(list, (b) => Number(b.upi_amount))),
      discount_given: toWholeNumber(sum(list, (b) => Number(b.discount))),
      items_sold: list.reduce(
        (s, b) => s + ((b.items as any[]) || []).reduce((a, i) => a + Number(i.qty), 0),
        0
      ),
      average_bill_value: list.length ? toWholeNumber(total_sales / list.length) : 0,
    };
  },

  // Inventory Report
  inventoryReport: async (): Promise<InventoryReport> => {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("category")
      .order("item_name");
    if (error) throw new Error(error.message);
    const items = (data || []) as InventoryItem[];
    const total_opening = items.reduce((s, i) => s + i.opening_qty, 0);
    const total_current = items.reduce((s, i) => s + i.current_qty, 0);
    const total_sold = items.reduce((s, i) => s + i.sold_qty, 0);
    const low_stock = items.filter((i) => i.current_qty <= 5);
    return {
      items,
      summary: { total_opening, total_current, total_sold, low_stock_count: low_stock.length },
      low_stock,
    };
  },

  // Category Report
  categoryReport: async (): Promise<{ rows: CategoryRow[] }> => {
    const [{ data: bills }, { data: inv }] = await Promise.all([
      supabase.from("v_bills_full").select("items,gross_amount,discount,final_amount"),
      supabase.from("inventory").select("item_id,category,cost_price"),
    ]);
    const costByItem: Record<string, number> = {};
    const catByItem: Record<string, string> = {};
    (inv || []).forEach((i: any) => {
      costByItem[i.item_id] = Number(i.cost_price) || 0;
      catByItem[i.item_id] = i.category;
    });
    const agg: Record<string, { qty: number; revenue: number; cost: number }> = {};
    (bills || []).forEach((b: any) => {
      const gross = Number(b.gross_amount) || 0;
      const finalAmt = Number(b.final_amount) || 0;
      const ratio = gross > 0 ? finalAmt / gross : 1;
      (b.items || []).forEach((it: any) => {
        const cat = catByItem[it.item_id] || "Unknown";
        const row = agg[cat] || (agg[cat] = { qty: 0, revenue: 0, cost: 0 });
        row.qty += Number(it.qty);
        row.revenue += Number(it.line_total) * ratio;
        row.cost += (costByItem[it.item_id] || 0) * Number(it.qty);
      });
    });
    const rows: CategoryRow[] = Object.entries(agg)
      .map(([category, r]) => {
        const revenue = toWholeNumber(r.revenue);
        const cost = toWholeNumber(r.cost);
        const profit = toWholeNumber(revenue - cost);
        const margin = revenue > 0 ? toWholeNumber((profit / revenue) * 100) : 0;
        return { category, qty_sold: r.qty, revenue, cost, profit, margin_pct: margin };
      })
      .sort((a, b) => b.revenue - a.revenue);
    return { rows };
  },

  // Customer lookup
  lookupCustomer: async (mobile: string): Promise<CustomerInfo> => {
    const { data, error } = await supabase
      .from("bills")
      .select("final_amount,customer_name,date")
      .eq("customer_mobile", mobile)
      .order("iso", { ascending: false });
    if (error) throw new Error(error.message);
    const list = data || [];
    if (list.length === 0) {
      return { mobile, is_returning: false, visits: 0, total_spent: 0, last_visit: null, last_name: null };
    }
    const total_spent = toWholeNumber(list.reduce((s: number, b: any) => s + Number(b.final_amount), 0));
    const last_name = (list.find((b: any) => b.customer_name)?.customer_name) || null;
    return {
      mobile,
      is_returning: true,
      visits: list.length,
      total_spent,
      last_visit: list[0].date,
      last_name,
    };
  },

  // WhatsApp closing
  whatsappClosing: async (date?: string): Promise<WhatsAppClosing> => {
    const r = await api.dailyReport(date);
    const lines = [
      `*${STORE_NAME} — Daily Closing*`,
      `Date: ${r.date}`,
      "",
      `Bills: ${r.total_bills}`,
      `Total Sales: ₹${toWholeNumber(r.total_sales).toLocaleString("en-IN")}`,
      `Cash: ₹${toWholeNumber(r.total_cash).toLocaleString("en-IN")}`,
      `UPI: ₹${toWholeNumber(r.total_upi).toLocaleString("en-IN")}`,
      `Discount Given: ₹${toWholeNumber(r.discount_given).toLocaleString("en-IN")}`,
      `Items Sold: ${r.items_sold}`,
    ];
    const message = lines.join("\n");
    const encoded = encodeURIComponent(message);
    return {
      date: r.date,
      message,
      owner_numbers: OWNER_WHATSAPP_NUMBERS,
      links: OWNER_WHATSAPP_NUMBERS.map((n) => ({
        number: n,
        url: `https://wa.me/91${n}?text=${encoded}`,
      })),
    };
  },

  // Seed sample inventory (idempotent)
  seed: async () => {
    const { count } = await supabase.from("inventory").select("*", { count: "exact", head: true });
    if ((count || 0) > 0) return { seeded: false };
    const samples = [
      ["PENDANT250", "Pendant", "Pendant 250", 250, 80, 100],
      ["PENDANT500", "Pendant", "Pendant 500", 500, 180, 50],
      ["EARRING200", "Earring", "Earring 200", 200, 60, 50],
      ["EARRING400", "Earring", "Earring 400", 400, 150, 30],
      ["RING300", "Ring", "Ring 300", 300, 100, 40],
      ["RING600", "Ring", "Ring 600", 600, 220, 20],
      ["BANGLE800", "Bangle", "Bangle 800", 800, 320, 15],
      ["NECKLACE1200", "Necklace", "Necklace 1200", 1200, 500, 10],
      ["BRACELET450", "Bracelet", "Bracelet 450", 450, 170, 25],
      ["ANKLET350", "Anklet", "Anklet 350", 350, 130, 5],
    ];
    const payload = samples.map(([item_id, category, name, price, cost, qty]) => ({
      item_id, category, item_name: name, price: toWholeNumber(price as number), cost_price: toWholeNumber(cost as number),
      opening_qty: qty, current_qty: qty, sold_qty: 0,
    }));
    const { error } = await supabase.from("inventory").insert(payload);
    if (error) throw new Error(error.message);
    return { seeded: true };
  },

  // Day open/closed status — shared across devices via Supabase so the
  // "is the shop open today?" answer is consistent no matter which phone
  // asked or answered it.
  getDayStatus: async (dateISO: string): Promise<"open" | "closed" | null> => {
    const { data, error } = await supabase
      .from("day_status")
      .select("status")
      .eq("day_date", dateISO)
      .maybeSingle();
    if (error && (error as any).code !== "PGRST116") throw new Error(error.message);
    return (data?.status as "open" | "closed" | undefined) ?? null;
  },

  setDayStatus: async (
    dateISO: string,
    status: "open" | "closed",
    setByEmail?: string | null
  ): Promise<void> => {
    const { error } = await supabase
      .from("day_status")
      .upsert([{ day_date: dateISO, status, set_by: setByEmail || null }], { onConflict: "day_date" });
    if (error) throw new Error(error.message);
  },

  getDayStatusRange: async (
    fromISO: string,
    toISO: string
  ): Promise<Record<string, "open" | "closed">> => {
    const { data, error } = await supabase
      .from("day_status")
      .select("day_date,status")
      .gte("day_date", fromISO)
      .lte("day_date", toISO);
    if (error) throw new Error(error.message);
    const out: Record<string, "open" | "closed"> = {};
    for (const row of data || []) {
      out[(row as any).day_date] = (row as any).status;
    }
    return out;
  },
};

// ---------- Updated Expenses API Surface ----------
export const expensesApi = {
  overview: async (): Promise<ExpenseOverview> => {
    const [salesRes, expRes, setRes] = await Promise.all([
      supabase.from("bills").select("final_amount"),
      supabase.from("expenses").select("amount,personal_amount,business_amount"),
      supabase.from("app_settings").select("value_num").eq("key", "personal_fund_total").maybeSingle(),
    ]);
    if (salesRes.error) throw new Error(salesRes.error.message);
    if (expRes.error) throw new Error(expRes.error.message);
    if (setRes.error && !setRes.error.message.includes("row")) throw new Error(setRes.error.message);

    const business_fund_total = toWholeNumber(sum(salesRes.data || [], (b: any) => Number(b.final_amount)));
    const personal_spent = toWholeNumber(sum(expRes.data || [], (e: any) => Number(e.personal_amount)));
    const business_spent = toWholeNumber(sum(expRes.data || [], (e: any) => Number(e.business_amount)));
    const total_expenses = toWholeNumber(sum(expRes.data || [], (e: any) => Number(e.amount)));
    const personal_fund_total = toWholeNumber(setRes.data?.value_num ?? 200000);

    return {
      personal_fund_total,
      business_fund_total,
      personal_spent,
      business_spent,
      personal_balance: toWholeNumber(personal_fund_total - personal_spent),
      business_balance: toWholeNumber(business_fund_total - business_spent),
      total_expenses,
      entries: (expRes.data || []).length,
    };
  },

  list: async (): Promise<Expense[]> => {
    const { data, error } = await supabase
      .from("expenses")
      .select(`*, items:expense_items(*)`)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    
    return (data || []).map((e: any) => ({
      ...e,
      amount: toWholeNumber(e.amount),
      personal_amount: toWholeNumber(e.personal_amount),
      business_amount: toWholeNumber(e.business_amount),
      parent_name: e.parent_name || e.note || "Unnamed Batch",
      total_amount: toWholeNumber(e.amount)
    })) as Expense[];
  },

  create: async (body: {
    expense_date: string;
    parent_name: string;
    amount: number;
    source: "personal" | "business" | "both";
    personal_amount: number;
    business_amount: number;
    note: string | null;
    receipt_base64?: string | null;
    receipt_mime?: string | null;
    items: ExpenseItem[];
  }): Promise<Expense> => {
    const { data: parent, error: pErr } = await supabase
      .from("expenses")
      .insert({
        expense_date: body.expense_date,
        parent_name: body.parent_name,
        amount: toWholeNumber(body.amount),
        source: body.source,
        personal_amount: toWholeNumber(body.personal_amount),
        business_amount: toWholeNumber(body.business_amount),
        note: body.note,
        receipt_base64: body.receipt_base64,
        receipt_mime: body.receipt_mime
      })
      .select()
      .single();

    if (pErr) throw new Error(pErr.message);

    if (body.items && body.items.length > 0) {
      const childrenPayload = body.items.map(item => ({
        expense_id: parent.id,
        amount: toWholeNumber(item.amount),
        source: item.source,
        personal_amount: toWholeNumber(item.personal_amount),
        business_amount: toWholeNumber(item.business_amount),
        note: item.note
      }));

      const { error: cErr } = await supabase.from("expense_items").insert(childrenPayload);
      if (cErr) throw new Error("Parent saved, but child line items failed: " + cErr.message);
    }

    return parent as Expense;
  },

  update: async (id: string, body: {
    expense_date: string;
    parent_name: string;
    amount: number;
    source: "personal" | "business" | "both";
    personal_amount: number;
    business_amount: number;
    note: string | null;
    items: ExpenseItem[];
  }): Promise<void> => {
    const { error: pErr } = await supabase
      .from("expenses")
      .update({
        expense_date: body.expense_date,
        parent_name: body.parent_name,
        amount: toWholeNumber(body.amount),
        source: body.source,
        personal_amount: toWholeNumber(body.personal_amount),
        business_amount: toWholeNumber(body.business_amount),
        note: body.note
      })
      .eq("id", id);
    if (pErr) throw new Error(pErr.message);

    const { error: dErr } = await supabase.from("expense_items").delete().eq("expense_id", id);
    if (dErr) throw new Error(dErr.message);

    if (body.items && body.items.length > 0) {
      const childrenPayload = body.items.map(item => ({
        expense_id: id,
        amount: toWholeNumber(item.amount),
        source: item.source,
        personal_amount: toWholeNumber(item.personal_amount),
        business_amount: toWholeNumber(item.business_amount),
        note: item.note
      }));
      const { error: cErr } = await supabase.from("expense_items").insert(childrenPayload);
      if (cErr) throw new Error(cErr.message);
    }
  },

  setPersonalFund: async (value: number) => {
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: "personal_fund_total", value_num: toWholeNumber(value), updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  },

  diagnose: async (): Promise<{ table: string; ok: boolean; message: string }[]> => {
    const tables = ["bills", "inventory", "expenses", "expense_items", "app_settings"];
    const out: { table: string; ok: boolean; message: string }[] = [];
    for (const t of tables) {
      const { error } = await supabase.from(t).select("*").limit(1);
      out.push({ table: t, ok: !error, message: error ? error.message : "reachable" });
    }
    return out;
  },
};

// ---------- Enhanced Date Formatter ----------
export function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const cleanDate = dateStr.split("T")[0]; 
  const [year, month, day] = cleanDate.split("-");
  if (!year || !month || !day) return dateStr;

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthName = months[parseInt(month, 10) - 1] || month;
  return `${parseInt(day, 10)} ${monthName} ${year}`;
}

// ---------- token helpers ----------
export async function getToken(): Promise<string | null> {
  const s = await getSession();
  return s?.access_token || null;
}
export async function clearToken() { await logout(); }
export async function setToken(_t: string) {}

// ---------- Billing config ----------
export type DiscountType = "percent" | "flat";
export interface BillingConfig {
  discount_type: DiscountType;
  discount_value: number;      
  discount_min_order: number;  
}

const DEFAULT_BILLING_CONFIG: BillingConfig = {
  discount_type: "percent",
  discount_value: 10,
  discount_min_order: 699,
};

export const settingsApi = {
  getBillingConfig: async (): Promise<BillingConfig> => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key,value_num,value_text")
      .in("key", ["discount_type", "discount_value", "discount_min_order"]);
    if (error) throw new Error(error.message);
    const cfg = { ...DEFAULT_BILLING_CONFIG };
    (data || []).forEach((r: any) => {
      if (r.key === "discount_type") {
        const t = String(r.value_text || "").toLowerCase();
        if (t === "flat" || t === "percent") cfg.discount_type = t as DiscountType;
      } else if (r.key === "discount_value") {
        const n = Number(r.value_num);
        if (!isNaN(n) && n >= 0) cfg.discount_value = toWholeNumber(n);
      } else if (r.key === "discount_min_order") {
        const n = Number(r.value_num);
        if (!isNaN(n) && n >= 0) cfg.discount_min_order = toWholeNumber(n);
      }
    });
    return cfg;
  },

  updateBillingConfig: async (cfg: BillingConfig): Promise<void> => {
    const now = new Date().toISOString();
    const rows = [
      { key: "discount_type", value_num: null, value_text: cfg.discount_type, updated_at: now },
      { key: "discount_value", value_num: toWholeNumber(cfg.discount_value), value_text: null, updated_at: now },
      { key: "discount_min_order", value_num: toWholeNumber(cfg.discount_min_order), value_text: null, updated_at: now },
    ];
    const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);
  },
};

// ---------- Damaged items ----------
export type DamagedStatus = "in_stock" | "sold" | "discarded";
export interface DamagedItem {
  id: string;
  inv_id: string | null;
  item_id: string;
  item_name: string;
  category: string | null;
  qty: number;
  unit_price: number;
  reason: string;
  status: DamagedStatus;
  sold_price: number | null;
  sold_at: string | null;
  sold_note: string | null;
  damaged_at: string;
  damaged_by_email: string | null;
}

export interface DamagedSummary {
  in_stock_count: number;
  in_stock_qty: number;
  sold_count: number;
  sold_revenue: number;
  discarded_count: number;
  loss_at_cost: number;
}

export const damagedApi = {
  list: async (status?: DamagedStatus): Promise<DamagedItem[]> => {
    let q = supabase.from("damaged_items").select("*").order("damaged_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(i => ({
      ...i,
      unit_price: toWholeNumber(i.unit_price),
      sold_price: i.sold_price ? toWholeNumber(i.sold_price) : null
    })) as DamagedItem[];
  },

  summary: async (): Promise<DamagedSummary> => {
    const { data, error } = await supabase.from("damaged_items").select("status,qty,sold_price,unit_price");
    if (error) throw new Error(error.message);
    const list = data || [];
    let in_stock_count = 0, in_stock_qty = 0;
    let sold_count = 0, sold_revenue = 0;
    let discarded_count = 0, loss_at_cost = 0;
    list.forEach((r: any) => {
      if (r.status === "in_stock") {
        in_stock_count += 1;
        in_stock_qty += Number(r.qty) || 0;
      } else if (r.status === "sold") {
        sold_count += 1;
        sold_revenue += Number(r.sold_price) || 0;
      } else if (r.status === "discarded") {
        discarded_count += 1;
        loss_at_cost += (Number(r.unit_price) || 0) * (Number(r.qty) || 0);
      }
    });
    return {
      in_stock_count,
      in_stock_qty,
      sold_count,
      sold_revenue: toWholeNumber(sold_revenue),
      discarded_count,
      loss_at_cost: toWholeNumber(loss_at_cost),
    };
  },

  markDamaged: async (inv_id: string, qty: number, reason: string) => {
    const { data, error } = await supabase.rpc("mark_damaged", {
      p_inv_id: inv_id,
      p_qty: qty,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  sellDamaged: async (id: string, sold_price: number, note: string | null) => {
    const { data, error } = await supabase.rpc("sell_damaged", {
      p_damaged_id: id,
      p_sold_price: toWholeNumber(sold_price),
      p_note: note,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  discardDamaged: async (id: string) => {
    const { data, error } = await supabase.rpc("discard_damaged", { p_damaged_id: id });
    if (error) throw new Error(error.message);
    return data;
  },
};

// ---------- WhatsApp community invites ----------
export interface WhatsAppContact {
  mobile: string;
  last_name: string | null;
  bill_count: number;
  last_bill_iso: string; // ISO datetime of most recent bill
  invite_sent_at: string | null;
}

const DEFAULT_WA_LINK = "https://chat.whatsapp.com/DMU6HmjLdQiA0FuQKv1q3v";

// Normalize an Indian mobile into E.164-style digits for wa.me
// (wa.me wants digits only, country code included, no + / spaces / dashes).
export const normalizeIndianMobile = (raw: string): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  return null; // unknown format — caller should fall back gracefully
};

export const whatsappApi = {
  getSettings: async (): Promise<{ link: string; autoOpen: boolean }> => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key,value_text")
      .in("key", ["whatsapp_community_link", "whatsapp_auto_open"]);
    if (error) throw new Error(error.message);
    let link = DEFAULT_WA_LINK;
    let autoOpen = true;
    (data || []).forEach((r: any) => {
      if (r.key === "whatsapp_community_link" && r.value_text) link = r.value_text;
      if (r.key === "whatsapp_auto_open") autoOpen = String(r.value_text).toLowerCase() !== "false";
    });
    return { link, autoOpen };
  },

  updateSettings: async (patch: { link?: string; autoOpen?: boolean }): Promise<void> => {
    const now = new Date().toISOString();
    const rows: any[] = [];
    if (patch.link !== undefined) {
      rows.push({
        key: "whatsapp_community_link",
        value_text: patch.link,
        value_num: null,
        updated_at: now,
      });
    }
    if (patch.autoOpen !== undefined) {
      rows.push({
        key: "whatsapp_auto_open",
        value_text: patch.autoOpen ? "true" : "false",
        value_num: null,
        updated_at: now,
      });
    }
    if (rows.length === 0) return;
    const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);
  },

  // Derive the contacts list from bills (group by mobile). Left-joined
  // with whatsapp_invites in-memory so we can flag which have been sent.
  getContacts: async (): Promise<WhatsAppContact[]> => {
    const [{ data: bills, error: e1 }, { data: sent, error: e2 }] = await Promise.all([
      supabase
        .from("bills")
        .select("customer_mobile,customer_name,iso")
        .not("customer_mobile", "is", null)
        .order("iso", { ascending: false }),
      supabase.from("whatsapp_invites").select("mobile,sent_at"),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    const sentMap = new Map<string, string>();
    (sent || []).forEach((s: any) => sentMap.set(s.mobile, s.sent_at));
    const byMobile = new Map<string, WhatsAppContact>();
    (bills || []).forEach((b: any) => {
      const m = String(b.customer_mobile || "").trim();
      if (!m) return;
      const existing = byMobile.get(m);
      if (existing) {
        existing.bill_count += 1;
        // First bill in DESC order sets last_bill_iso; keep it.
        if (!existing.last_name && b.customer_name) existing.last_name = b.customer_name;
      } else {
        byMobile.set(m, {
          mobile: m,
          last_name: b.customer_name || null,
          bill_count: 1,
          last_bill_iso: b.iso,
          invite_sent_at: sentMap.get(m) || null,
        });
      }
    });
    return Array.from(byMobile.values()).sort(
      (a, b) => new Date(b.last_bill_iso).getTime() - new Date(a.last_bill_iso).getTime()
    );
  },

  isInvited: async (mobile: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from("whatsapp_invites")
      .select("mobile")
      .eq("mobile", mobile)
      .maybeSingle();
    if (error && (error as any).code !== "PGRST116") throw new Error(error.message);
    return !!data;
  },

  markSent: async (mobile: string, sentByEmail?: string | null): Promise<void> => {
    const { error } = await supabase
      .from("whatsapp_invites")
      .upsert(
        [{ mobile, sent_at: new Date().toISOString(), sent_by_email: sentByEmail || null }],
        { onConflict: "mobile" }
      );
    if (error) throw new Error(error.message);
  },

  // Build a wa.me deep-link with the pre-filled invite message.
  buildInviteUrl: (mobile: string, name: string | null, link: string): string | null => {
    const normalized = normalizeIndianMobile(mobile);
    if (!normalized) return null;
    const greeting = name && name.trim() ? `Hi ${name.trim()}` : "Hi";
    const text = `${greeting}, thank you for shopping at ${STORE_NAME}! Join our WhatsApp community for exclusive offers and new arrivals: ${link}`;
    return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
  },
};

// ---------- utils ----------
function sum<T>(arr: T[], f: (t: T) => number) {
  return arr.reduce((s, x) => s + (f(x) || 0), 0);
}
